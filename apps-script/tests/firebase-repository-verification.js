/* Run with: node tests/firebase-repository-verification.js
 * Verifies FirebaseRealtimeDbRepository builds requests correctly and handles
 * responses correctly against a mocked REST backend — it cannot prove Firebase's
 * real API accepts this shape or that the JWT is actually valid, since that needs
 * live credentials. Live verification happens once FIREBASE_* Script Properties
 * are set (see PROGRESS.md). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const serviceAccount = { client_email: 'test@example.iam.gserviceaccount.com', private_key: 'fake-key-not-real-pem' };
const properties = {
  FIREBASE_DATABASE_URL: 'https://example-default-rtdb.asia-southeast1.firebasedatabase.app',
  FIREBASE_SERVICE_ACCOUNT_B64: Buffer.from(JSON.stringify(serviceAccount)).toString('base64')
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; }, deleteProperty: key => { delete properties[key]; } }) };
global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
global.Utilities = {
  base64Decode: str => Buffer.from(str, 'base64'),
  base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  newBlob: input => ({ getBytes: () => Buffer.from(Array.isArray(input) ? input : String(input), Array.isArray(input) ? undefined : 'utf8'), getDataAsString: () => Buffer.from(input).toString('utf8') }),
  computeRsaSha256Signature: (input, key) => Buffer.from('signed:' + input.length + ':' + key.length),
  getUuid: (() => { let n = 0; return () => String(++n); })()
};

// Mock backend: an in-memory Firebase database keyed by collection/id, plus a
// canned OAuth2 token response, routed by URL.
let tokenFetchCount = 0;
let dataFetchCount = 0;
const db = {};
global.UrlFetchApp = {
  fetch: (url, options) => {
    if (url.indexOf('oauth2.googleapis.com') !== -1) {
      tokenFetchCount++;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ access_token: 'mock-token-' + tokenFetchCount, expires_in: 3600 }) };
    }
    dataFetchCount++;
    const match = url.match(/firebasedatabase\.app\/([^/]+)(?:\/([^/.]+))?\.json/);
    const collection = match[1], id = match[2];
    db[collection] = db[collection] || {};
    if (options.method === 'get') {
      const value = id ? (db[collection][id] || null) : (Object.keys(db[collection]).length ? db[collection] : null);
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(value) };
    }
    if (options.method === 'put') {
      db[collection][id] = JSON.parse(options.payload);
      return { getResponseCode: () => 200, getContentText: () => options.payload };
    }
    if (options.method === 'delete') {
      delete db[collection][id];
      return { getResponseCode: () => 200, getContentText: () => 'null' };
    }
    return { getResponseCode: () => 400, getContentText: () => 'unsupported method in mock' };
  }
};

const srcDir = path.join(__dirname, '..', 'src');
fs.readdirSync(srcDir).filter(file => file.endsWith('.gs')).sort().forEach(file => {
  vm.runInThisContext(fs.readFileSync(path.join(srcDir, file), 'utf8'), { filename: file });
});

// Config guards.
delete properties.FIREBASE_DATABASE_URL;
assert.throws(() => new FirebaseRealtimeDbRepository('messages').list(), error => error.code === 'CONFIGURATION_ERROR');
properties.FIREBASE_DATABASE_URL = 'https://example-default-rtdb.asia-southeast1.firebasedatabase.app';

const repo = new FirebaseRealtimeDbRepository('messages');

// Empty collection.
assert.deepStrictEqual(repo.list(), []);
assert.strictEqual(repo.count(), 0);
assert.strictEqual(repo.get('missing'), null);

// create / get / list / findOne.
const recordA = { id: 'message_1', conversationId: 'conversation_1', messageText: 'Hola', direction: 'INBOUND' };
repo.create(recordA);
assert.throws(() => repo.create(recordA), error => error.code === 'CONFLICT');
assert.deepStrictEqual(repo.get('message_1'), recordA);
assert.strictEqual(repo.count(), 1);
assert.strictEqual(repo.findOne(m => m.direction === 'INBOUND').id, 'message_1');
assert.strictEqual(repo.findOne(m => m.direction === 'OUTBOUND'), null);

// update.
const updated = repo.update('message_1', { status: 'SENT' });
assert.strictEqual(updated.status, 'SENT');
assert.strictEqual(updated.messageText, 'Hola'); // untouched fields survive the merge
assert.throws(() => repo.update('missing', { status: 'SENT' }), error => error.code === 'NOT_FOUND');

// replace.
repo.replace('message_2', { id: 'message_2', conversationId: 'conversation_1', messageText: 'Hello', direction: 'OUTBOUND' });
assert.strictEqual(repo.count(), 2);

// remove.
repo.remove('message_1');
assert.strictEqual(repo.count(), 1);
assert.strictEqual(repo.get('message_1'), null);
assert.throws(() => repo.remove('message_1'), error => error.code === 'NOT_FOUND');

// A 400+ response surfaces as EXTERNAL_ERROR, not a silent failure. Uses a fresh,
// never-read collection so the read cache (added below) can't mask this behind a
// cache hit — this must actually reach the network to prove the point.
const originalFetch = global.UrlFetchApp.fetch;
global.UrlFetchApp.fetch = (url, options) => url.indexOf('oauth2') !== -1 ? originalFetch(url, options) : { getResponseCode: () => 403, getContentText: () => 'Permission denied' };
assert.throws(() => new FirebaseRealtimeDbRepository('never_before_read_collection').list(), error => error.code === 'EXTERNAL_ERROR');
global.UrlFetchApp.fetch = originalFetch;

// Token caching: the token endpoint is hit once, then reused from the Script
// Property cache across repeated calls (bounded by TTL, not re-fetched every time).
const fetchCountBefore = tokenFetchCount;
repo.list(); repo.list(); repo.list();
assert.strictEqual(tokenFetchCount, fetchCountBefore); // no new token fetches — still cached

// Once the cached token is expired, a fresh one is fetched. Data cache is cleared
// first so this read actually reaches the network instead of being served from the
// data cache (which would skip token logic entirely, same reasoning as above).
const cached = JSON.parse(properties.FIREBASE_TOKEN_CACHE);
properties.FIREBASE_TOKEN_CACHE = JSON.stringify(Object.assign({}, cached, { expiresAt: Date.now() - 1000 }));
delete FirebaseReadCache_['messages'];
repo.list();
assert.strictEqual(tokenFetchCount, fetchCountBefore + 1);

// The actual bug being fixed: each service class builds its own repository
// instance (new ConversationRepository() in Phase5Api, Phase7Api, Phase8Api,
// Phase9Api, ...), so without a shared cache, one aggregated call was doing one
// live network round-trip per instance for data that hadn't changed. Multiple
// instances of the same collection must share one cached read.
delete FirebaseReadCache_['messages'];
const dataFetchesBefore = dataFetchCount;
new FirebaseRealtimeDbRepository('messages').list();
new FirebaseRealtimeDbRepository('messages').list();
new FirebaseRealtimeDbRepository('messages').list();
assert.strictEqual(dataFetchCount, dataFetchesBefore + 1); // 3 instances, 1 network read

// A write correctly invalidates the cache — a read right after a write is never stale.
// (message_2 survives from the replace() call earlier; message_1 was removed.)
new FirebaseRealtimeDbRepository('messages').create({ id: 'message_3', conversationId: 'conversation_1', messageText: 'New', direction: 'INBOUND' });
assert.strictEqual(new FirebaseRealtimeDbRepository('messages').count(), 2);

console.log('Firebase repository verification: PASS');

/* Run with: node tests/phase4-webhook-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = {
  SPREADSHEET_ID: 'mock-spreadsheet-id', WEBHOOK_SECRET_TOKEN: 'secret123',
  EXOTEL_API_KEY: 'key', EXOTEL_API_TOKEN: 'token', EXOTEL_ACCOUNT_SID: 'sid', EXOTEL_SUBDOMAIN: 'api.exotel.com'
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) };
global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
global.Utilities = { getUuid: (() => { let n = 0; return () => String(++n); })(), base64Encode: str => Buffer.from(str, 'utf8').toString('base64') };
global.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => '{}' }) };
global.ContentService = {
  MimeType: { JSON: 'JSON' },
  createTextOutput: text => ({ text: text, setMimeType: function () { return this; } })
};

function makeSheet() {
  let rows = [];
  return {
    appendRow: values => { rows.push(values.slice()); },
    getDataRange: () => ({ getValues: () => rows.map(row => row.slice()) }),
    getRange: (rowIndex) => ({ setValues: values => { rows[rowIndex - 1] = values[0].slice(); }, setNumberFormat: () => {} }),
    getMaxRows: () => 1000,
    getLastRow: () => rows.length,
    deleteRow: rowIndex => { rows.splice(rowIndex - 1, 1); }
  };
}
function makeSpreadsheet() {
  const sheetsByName = {};
  return { getSheetByName: name => sheetsByName[name] || null, insertSheet: name => { const sheet = makeSheet(); sheetsByName[name] = sheet; return sheet; } };
}
const mockSpreadsheet = makeSpreadsheet();
global.SpreadsheetApp = { openById: () => mockSpreadsheet };


// Firebase mock (Messages/Conversations moved off Sheets to Firebase Realtime
// Database, 2026-08-11) — proves this file's own MessageRepository/
// ConversationRepository usage still works under the new backend. Falls back to
// this file's own pre-existing UrlFetchApp mock (if any) for anything that isn't a
// Firebase/OAuth2 URL, so Exotel-related mocks elsewhere in this file keep working.
properties.FIREBASE_DATABASE_URL = 'https://mock-default-rtdb.firebasedatabase.app';
properties.FIREBASE_SERVICE_ACCOUNT_B64 = Buffer.from(JSON.stringify({ client_email: 'test@example.iam.gserviceaccount.com', private_key: 'fake-key' })).toString('base64');
global.Utilities.base64EncodeWebSafe = bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
global.Utilities.computeRsaSha256Signature = (input, key) => Buffer.from('signed:' + input.length + ':' + key.length);
if (!global.Utilities.base64Decode) global.Utilities.base64Decode = str => Buffer.from(str, 'base64');
global.Utilities.newBlob = (data, contentType, name) => { const bytes = Buffer.isBuffer(data) || Array.isArray(data) ? Buffer.from(data) : Buffer.from(String(data), 'utf8'); return { bytes, mimeType: contentType, filename: name, getBytes: () => bytes, getDataAsString: () => bytes.toString('utf8') }; };
const firebaseMockDb_ = {};
const priorUrlFetchAppFetch_ = global.UrlFetchApp ? global.UrlFetchApp.fetch : null;
global.UrlFetchApp = {
  fetch: (url, options) => {
    if (url.indexOf('oauth2.googleapis.com') !== -1) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }) };
    const firebaseMatch = url.match(/firebasedatabase\.app\/([^/]+)(?:\/([^/.]+))?\.json/);
    if (firebaseMatch) {
      const collection = firebaseMatch[1], id = firebaseMatch[2];
      firebaseMockDb_[collection] = firebaseMockDb_[collection] || {};
      if (options.method === 'get') {
        const value = id ? (firebaseMockDb_[collection][id] || null) : (Object.keys(firebaseMockDb_[collection]).length ? firebaseMockDb_[collection] : null);
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(value) };
      }
      if (options.method === 'put') { firebaseMockDb_[collection][id] = JSON.parse(options.payload); return { getResponseCode: () => 200, getContentText: () => options.payload }; }
      if (options.method === 'delete') { delete firebaseMockDb_[collection][id]; return { getResponseCode: () => 200, getContentText: () => 'null' }; }
    }
    if (priorUrlFetchAppFetch_) return priorUrlFetchAppFetch_(url, options);
    return { getResponseCode: () => 400, getContentText: () => 'unhandled request in mock' };
  }
};

const srcDir = path.join(__dirname, '..', 'src');
fs.readdirSync(srcDir).filter(file => file.endsWith('.gs')).sort().forEach(file => {
  vm.runInThisContext(fs.readFileSync(path.join(srcDir, file), 'utf8'), { filename: file });
});

new NumberRepository().create({ id: 'number_1', displayName: 'Sales 1', phoneNumber: '079-485-02801', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

const inboundPayload = { whatsapp: { messages: [{ callback_type: 'incoming_message', sid: 'wamid.1', from: '+919999999999', to: '+917948502801', profile_name: 'Eva', content: { type: 'text', text: { body: 'Hi' } }, timestamp: '2026-08-09T00:00:00.000Z' }] } };

// Missing token: rejected, nothing written.
let response = JSON.parse(doPost({ parameter: {}, postData: { contents: JSON.stringify(inboundPayload) } }).text);
assert.strictEqual(response.status, 'error');
assert.strictEqual(response.message, 'unauthorized');
assert.strictEqual(new MessageRepository().list().length, 0);

// Wrong token: also rejected.
response = JSON.parse(doPost({ parameter: { token: 'wrong' }, postData: { contents: JSON.stringify(inboundPayload) } }).text);
assert.strictEqual(response.status, 'error');
assert.strictEqual(new MessageRepository().list().length, 0);

// Correct token, valid payload: ingested successfully.
response = JSON.parse(doPost({ parameter: { token: 'secret123' }, postData: { contents: JSON.stringify(inboundPayload) } }).text);
assert.strictEqual(response.status, 'ok');
assert.strictEqual(response.result.duplicate, false);
assert.strictEqual(new MessageRepository().list().length, 1);
assert.strictEqual(new CustomerRepository().get(response.result.customerId).name, 'Eva');

// Same payload again: duplicate, no new message row.
response = JSON.parse(doPost({ parameter: { token: 'secret123' }, postData: { contents: JSON.stringify(inboundPayload) } }).text);
assert.strictEqual(response.result.duplicate, true);
assert.strictEqual(new MessageRepository().list().length, 1);

// Malformed JSON body: caught, reported as an error, nothing thrown out of doPost.
response = JSON.parse(doPost({ parameter: { token: 'secret123' }, postData: { contents: 'not json' } }).text);
assert.strictEqual(response.status, 'error');

console.log('Phase 4 webhook verification: PASS');

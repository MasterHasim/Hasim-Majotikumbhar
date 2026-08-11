/* Run with: node tests/phase4-ingestion-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = { SPREADSHEET_ID: 'mock-spreadsheet-id' };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) };
global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
global.Utilities = { getUuid: (() => { let n = 0; return () => String(++n); })() };

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

const api = () => new Phase4Api();
// providerNumberId here is the raw webhook `to` value (a phone number, confirmed live
// 2026-08-10), matched against the registered number's phoneNumber by digit tail —
// not an opaque provider ID.
const inboundMessage = (providerMessageId, overrides) => Object.assign({
  providerMessageId, fromPhone: '+919999999999', providerNumberId: '+917948502801',
  direction: 'INBOUND', messageType: 'text', text: 'Hello', timestamp: '2026-08-09T00:00:00.000Z', status: null
}, overrides || {});

// Unknown number is rejected before any customer/conversation is created.
assert.throws(() => api().ingestInboundMessage(inboundMessage('wamid.1')), error => error.code === 'NOT_FOUND');

// Register the number the message claims to be for (stored in our "079-485-02801" style; the webhook sends "+917948502801").
new NumberRepository().create({ id: 'number_1', displayName: 'Sales 1', phoneNumber: '079-485-02801', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

// A brand-new lead should come out of ingestion auto-assigned via Phase 7's round robin
// (integration check — Phase7's own test suite covers the algorithm in depth). Written
// directly to the repositories since this file has no bootstrapped Phase 1 identity
// (a webhook has none either) and Phase 7's auto-assign path needs none.
const propsRepo = new PropertiesRepository();
propsRepo.create('users', { id: 'user_agent1', email: 'agent1@example.com', displayName: 'Agent One', status: 'active', roleIds: [], createdAt: '', updatedAt: '' });
propsRepo.create('numberAccess', { id: 'na_1', userId: 'user_agent1', numberId: 'number_1', granted: true, status: 'active', createdAt: '', updatedAt: '' });
propsRepo.create('assignmentEligibility', { id: 'user_agent1:number_1', userId: 'user_agent1', numberId: 'number_1', teamId: 'team_x', eligible: true, updatedAt: '' });
propsRepo.replace('availability', 'user_agent1', { userId: 'user_agent1', status: 'available', createdAt: '', updatedAt: '' });
new AccessRepository().users.create({ id: 'nau_1', numberId: 'number_1', userId: 'user_agent1', sequenceOrder: 1, active: true, createdAt: '', updatedAt: '' });
new AccessRepository().config.create({ id: 'config_1', numberId: 'number_1', roundRobinEnabled: true, fallbackUserId: '', workingHoursStart: '', workingHoursEnd: '', lastAssignedUserId: '', createdAt: '', updatedAt: '' });

// A differently-formatted but digit-equivalent number ("917948502801" vs "079-485-02801") still matches.
assert.doesNotThrow(() => api().ingestInboundMessage(inboundMessage('wamid.0', { providerNumberId: '917948502801' })));

// First message: creates a customer, a conversation, and the message — and the new
// lead gets auto-assigned via Phase 7's round robin (the number's only eligible agent).
const first = api().ingestInboundMessage(inboundMessage('wamid.1'));
assert.strictEqual(first.duplicate, false);
assert.ok(first.customerId);
assert.ok(first.conversationId);
assert.strictEqual(new ConversationRepository().get(first.conversationId).assignedUserId, 'user_agent1');
assert.strictEqual(new CustomerRepository().list().length, 1);
assert.strictEqual(new ConversationRepository().list().length, 1);
assert.strictEqual(new ConversationRepository().get(first.conversationId).needsResponse, true);

// Duplicate providerMessageId is a no-op. (2 messages so far: the format-check "wamid.0" plus "wamid.1".)
const duplicate = api().ingestInboundMessage(inboundMessage('wamid.1'));
assert.strictEqual(duplicate.duplicate, true);
assert.strictEqual(new MessageRepository().list().length, 2);

// A second, distinct message from the same customer reuses the same open conversation.
const second = api().ingestInboundMessage(inboundMessage('wamid.2'));
assert.strictEqual(second.conversationId, first.conversationId);
assert.strictEqual(new CustomerRepository().list().length, 1);
assert.strictEqual(new MessageRepository().list().length, 3);

// A status-callback-shaped payload (direction not INBOUND) updates the matching message.
const statusUpdate = api().ingestInboundMessage({ providerMessageId: 'wamid.1', direction: null, status: 'DELIVERED' });
assert.strictEqual(statusUpdate.applied, true);
assert.strictEqual(new MessageRepository().get(statusUpdate.messageId).status, 'DELIVERED');

// A status callback for an unknown message id is a harmless no-op.
const unknownStatus = api().ingestInboundMessage({ providerMessageId: 'wamid.missing', direction: null, status: 'SENT' });
assert.strictEqual(unknownStatus.applied, false);

console.log('Phase 4 ingestion verification: PASS');

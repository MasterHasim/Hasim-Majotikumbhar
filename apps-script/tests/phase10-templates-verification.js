/* Run with: node tests/phase10-templates-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = {
  SPREADSHEET_ID: 'mock-spreadsheet-id', 'wap.phase1.bootstrapAdminEmail': 'admin@example.com',
  EXOTEL_API_KEY: 'key', EXOTEL_API_TOKEN: 'token', EXOTEL_ACCOUNT_SID: 'sid', EXOTEL_SUBDOMAIN: 'api.exotel.com'
};
let email = 'admin@example.com';
global.Utilities = { getUuid: (() => { let n = 0; return () => String(++n); })(), base64Encode: str => Buffer.from(str, 'utf8').toString('base64') };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) };
global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
global.Session = { getActiveUser: () => ({ getEmail: () => email }) };

let nextFetchBehavior = null;
let lastFetchRequest = null;
global.UrlFetchApp = {
  fetch: (url, options) => {
    lastFetchRequest = { url, options, body: options.payload ? JSON.parse(options.payload) : null };
    const behavior = nextFetchBehavior();
    return { getResponseCode: () => behavior.code, getContentText: () => JSON.stringify(behavior.body) };
  }
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

const phase1 = () => new Phase1Api();
const phase6 = () => new Phase6Api();
const phase10 = () => new Phase10Api();
const forbidden = fn => assert.throws(fn, error => error && error.code === 'FORBIDDEN');

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;
const agent = phase1().createUser({ email: 'agent@example.com', displayName: 'Agent', roleIds: [roleId('AGENT')] });

// Only ADMIN can create/edit/submit template drafts.
forbidden(() => { email = 'agent@example.com'; phase10().createDraftTemplate({ name: 'order_update', language: 'en', category: 'UTILITY' }); });
email = 'admin@example.com';
const draft = phase10().createDraftTemplate({ name: 'order_update', language: 'en', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hi {{1}}, your order {{2}} has shipped.' }] });
assert.strictEqual(draft.status, 'LOCAL_DRAFT');

// Any authenticated user (including AGENT) can list/view templates.
email = 'agent@example.com';
assert.strictEqual(phase10().listTemplates().length, 1);
assert.strictEqual(phase10().getTemplate(draft.id).id, draft.id);
email = 'admin@example.com';

// Editing works while LOCAL_DRAFT.
const edited = phase10().updateDraftTemplate(draft.id, { wabaId: 'waba-1' });
assert.strictEqual(edited.wabaId, 'waba-1');

// Submitting without a wabaId first would fail — already set above, so this should succeed:
// creates a real template via ExotelProvider.createTemplate (mocked), transitions to PENDING.
nextFetchBehavior = () => ({ code: 200, body: { id: 'meta_template_123' } });
const submitted = phase10().submitTemplateForReview(draft.id);
assert.strictEqual(submitted.status, 'PENDING');
assert.strictEqual(submitted.providerTemplateId, 'meta_template_123');
assert.strictEqual(lastFetchRequest.body.waba_id, 'waba-1');
assert.strictEqual(lastFetchRequest.body.name, 'order_update');

// A PENDING template can no longer be edited or resubmitted.
assert.throws(() => phase10().updateDraftTemplate(draft.id, { name: 'x' }), error => error.code === 'VALIDATION_ERROR');
assert.throws(() => phase10().submitTemplateForReview(draft.id), error => error.code === 'VALIDATION_ERROR');

// Syncing from the provider upserts real template data using the confirmed live response shape.
nextFetchBehavior = () => ({
  code: 200,
  body: { request_id: 'r1', method: 'GET', http_code: 200, response: { whatsapp: { templates: [{ code: 200, data: { id: 'meta_template_123', name: 'order_update', language: 'en', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{1}}, your order {{2}} has shipped.' }] } }] } } }
});
const synced = phase10().syncTemplatesFromProvider('waba-1');
assert.strictEqual(synced.length, 1);
assert.strictEqual(synced[0].id, draft.id, 'sync should update the existing record (matched by providerTemplateId), not create a duplicate');
assert.strictEqual(synced[0].status, 'APPROVED');
assert.strictEqual(phase10().listTemplates().length, 1);

// Phase 6: sending a template requires it be APPROVED, substitutes variables into the body, and records an OUTBOUND template message.
const number = new NumberRepository().create({ id: 'number_1', displayName: 'Sales 1', phoneNumber: '079-485-02801', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '', updatedAt: '' });
const customer = new CustomerRepository().create({ id: 'customer_1', phone: '+919999999999', name: '', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
const conversation = new ConversationRepository().create({ id: 'conversation_1', customerId: customer.id, numberId: number.id, assignedUserId: agent.id, status: 'OPEN', needsResponse: true, lastMessageAt: '', createdAt: '', updatedAt: '' });
phase1().grantNumberAccess({ userId: agent.id, numberId: number.id });

email = 'agent@example.com';
nextFetchBehavior = () => ({ code: 200, body: { sid: 'wamid.template.1' } });
const templateMessage = phase6().sendTemplateReply(conversation.id, draft.id, { 1: 'Rahul', 2: '#12345' });
assert.strictEqual(templateMessage.status, 'SENT');
assert.strictEqual(templateMessage.messageType, 'template');
assert.strictEqual(lastFetchRequest.body.whatsapp.messages[0].content.template.name, 'order_update');
assert.strictEqual(lastFetchRequest.body.whatsapp.messages[0].content.template.components[0].text, 'Hi Rahul, your order #12345 has shipped.');

console.log('Phase 10 templates verification: PASS');

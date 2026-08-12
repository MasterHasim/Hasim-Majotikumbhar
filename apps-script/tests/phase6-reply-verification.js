/* Run with: node tests/phase6-reply-verification.js */
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

let nextFetchBehavior = () => ({ code: 200, body: { sid: 'wamid.out.1' } });
let lastFetchRequest = null;
global.UrlFetchApp = {
  fetch: (url, options) => {
    lastFetchRequest = { url, options, body: options.payload ? JSON.parse(options.payload) : null };
    const behavior = nextFetchBehavior();
    if (behavior.throw) throw new Error('network error');
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

let driveFilesCreated = [];
global.DriveApp = {
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
  Permission: { VIEW: 'VIEW' },
  createFile: blob => {
    const file = {
      id: 'file_' + (driveFilesCreated.length + 1),
      blob, shared: null,
      getId() { return this.id; },
      setSharing(access, permission) { this.shared = { access, permission }; return this; }
    };
    driveFilesCreated.push(file);
    return file;
  }
};
global.Utilities.base64Decode = str => Buffer.from(str, 'base64');
global.Utilities.newBlob = (bytes, mimeType, filename) => ({ bytes, mimeType, filename });


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

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;
const agent = phase1().createUser({ email: 'agent@example.com', displayName: 'Agent', roleIds: [roleId('AGENT')] });
const otherAgent = phase1().createUser({ email: 'other-agent@example.com', displayName: 'Other Agent', roleIds: [roleId('AGENT')] });
const viewer = phase1().createUser({ email: 'viewer@example.com', displayName: 'Viewer', roleIds: [roleId('VIEWER')] });

const number = new NumberRepository().create({ id: 'number_1', displayName: 'Sales 1', phoneNumber: '079-485-02801', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
const customer = new CustomerRepository().create({ id: 'customer_1', phone: '+919999999999', name: 'Test Customer', email: '', company: '', source: 'whatsapp', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
const conversation = new ConversationRepository().create({ id: 'conversation_1', customerId: customer.id, numberId: number.id, assignedUserId: agent.id, status: 'OPEN', needsResponse: true, lastMessageAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

phase1().grantNumberAccess({ userId: agent.id, numberId: number.id });
phase1().grantNumberAccess({ userId: otherAgent.id, numberId: number.id });
phase1().grantNumberAccess({ userId: viewer.id, numberId: number.id });

// AGENT assigned to the conversation can reply; request built with E.164 from/to.
email = 'agent@example.com';
const sent = phase6().sendReply(conversation.id, 'Hello there');
assert.strictEqual(sent.direction, 'OUTBOUND');
assert.strictEqual(sent.status, 'SENT');
assert.strictEqual(sent.senderUserId, agent.id);
assert.strictEqual(sent.providerMessageId, 'wamid.out.1');
assert.deepStrictEqual(lastFetchRequest.body.whatsapp.messages[0].from, '+917948502801');
assert.deepStrictEqual(lastFetchRequest.body.whatsapp.messages[0].to, '+919999999999');
assert.strictEqual(new ConversationRepository().get(conversation.id).needsResponse, false);

// A different AGENT, not assigned to this conversation, is denied.
email = 'other-agent@example.com';
assert.throws(() => phase6().sendReply(conversation.id, 'Hi'), error => error.code === 'FORBIDDEN');

// VIEWER can never reply.
email = 'viewer@example.com';
assert.throws(() => phase6().sendReply(conversation.id, 'Hi'), error => error.code === 'FORBIDDEN');

// ADMIN can reply to any conversation, including ones not assigned to them.
email = 'admin@example.com';
const adminReply = phase6().sendReply(conversation.id, 'Admin reply');
assert.strictEqual(adminReply.status, 'SENT');

// A provider/network failure records a FAILED message and leaves needsResponse untouched.
new ConversationRepository().update(conversation.id, { needsResponse: true });
nextFetchBehavior = () => ({ throw: true });
email = 'agent@example.com';
const failed = phase6().sendReply(conversation.id, 'This will fail');
assert.strictEqual(failed.status, 'FAILED');
assert.strictEqual(new ConversationRepository().get(conversation.id).needsResponse, true);

// resolveConversation: same authorization tier as reply — assigned AGENT or ADMIN.
email = 'other-agent@example.com';
assert.throws(() => phase6().resolveConversation(conversation.id), error => error.code === 'FORBIDDEN');
email = 'viewer@example.com';
assert.throws(() => phase6().resolveConversation(conversation.id), error => error.code === 'FORBIDDEN');

email = 'agent@example.com';
const resolved = phase6().resolveConversation(conversation.id);
assert.strictEqual(resolved.status, 'CLOSED');
assert.strictEqual(new ConversationRepository().get(conversation.id).status, 'CLOSED');

// uploadConversationMedia: same 'reply' authorization tier as sendReply.
email = 'other-agent@example.com';
assert.throws(() => phase6().uploadConversationMedia(conversation.id, 'YWJj', 'photo.jpg', 'image/jpeg'), error => error.code === 'FORBIDDEN');
email = 'viewer@example.com';
assert.throws(() => phase6().uploadConversationMedia(conversation.id, 'YWJj', 'photo.jpg', 'image/jpeg'), error => error.code === 'FORBIDDEN');

email = 'agent@example.com';
const uploaded = phase6().uploadConversationMedia(conversation.id, 'YWJj', 'photo.jpg', 'image/jpeg');
assert.strictEqual(uploaded.url, 'https://drive.google.com/uc?export=view&id=' + uploaded.fileId);
assert.strictEqual(driveFilesCreated.length, 1);
assert.deepStrictEqual(driveFilesCreated[0].shared, { access: 'ANYONE_WITH_LINK', permission: 'VIEW' });

phase6().uploadConversationMedia(conversation.id, 'ZGVm', 'doc.pdf', 'application/pdf');
assert.strictEqual(driveFilesCreated.length, 2);

console.log('Phase 6 reply verification: PASS');

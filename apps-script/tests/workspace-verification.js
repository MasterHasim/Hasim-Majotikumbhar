/* Run with: node tests/workspace-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = { SPREADSHEET_ID: 'mock-spreadsheet-id', 'wap.phase1.bootstrapAdminEmail': 'admin@example.com' };
let email = 'admin@example.com';
global.Utilities = { getUuid: (() => { let n = 0; return () => String(++n); })() };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) };
global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
global.Session = { getActiveUser: () => ({ getEmail: () => email }) };

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
const phase8 = () => new Phase8Api();
const phase9 = () => new Phase9Api();
const workspace = () => new WorkspaceApi();

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;

const agent = phase1().createUser({ email: 'agent@example.com', displayName: 'Agent', roleIds: [roleId('AGENT')] });
const viewer = phase1().createUser({ email: 'viewer@example.com', displayName: 'Viewer', roleIds: [roleId('VIEWER')] });

const number = new NumberRepository().create({ id: 'number_1', displayName: 'Sales 1', phoneNumber: '079-1', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '', updatedAt: '' });
const customer = new CustomerRepository().create({ id: 'customer_1', phone: '+919999999999', name: 'Test Customer', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
const conversation = new ConversationRepository().create({ id: 'conversation_1', customerId: customer.id, numberId: number.id, assignedUserId: agent.id, status: 'OPEN', needsResponse: true, lastMessageAt: '', createdAt: '', updatedAt: '' });
new MessageRepository().create({ id: 'message_1', conversationId: conversation.id, numberId: number.id, senderUserId: '', direction: 'INBOUND', messageType: 'text', messageText: 'Hi', providerMessageId: 'wamid.1', status: 'RECEIVED', timestamp: '2026-08-10T09:00:00.000Z' });
new MessageRepository().create({ id: 'message_2', conversationId: conversation.id, numberId: number.id, senderUserId: agent.id, direction: 'OUTBOUND', messageType: 'media', messageText: 'A photo', providerMessageId: '', status: 'SENT', timestamp: '2026-08-10T09:05:00.000Z' });
new MessageMediaRepository().create({ id: 'media_1', messageId: 'message_2', mediaType: 'image', mediaUrl: 'https://example.com/photo.jpg', caption: 'A photo' });

phase1().grantNumberAccess({ userId: agent.id, numberId: number.id });
phase1().grantNumberAccess({ userId: viewer.id, numberId: number.id });

phase8().seedDefaultLeadStages();
const wonStage = phase8().listStages().find(s => s.key === 'won');

email = 'agent@example.com';
phase8().setCustomerStage(customer.id, wonStage.id);
phase8().addRemark(conversation.id, 'Called once, no answer.');
phase9().createReminder(conversation.id, 'Follow up tomorrow', '2026-08-11T09:00:00.000Z');

// The full aggregate for a role with every relevant permission (AGENT, assigned to this conversation).
const full = workspace().getConversationWorkspace(conversation.id);
assert.strictEqual(full.conversation.id, conversation.id);
assert.strictEqual(full.customer.id, customer.id);
assert.strictEqual(full.number.id, number.id);
assert.strictEqual(full.assignedUserName, 'Agent');
assert.strictEqual(full.messages.length, 2);
assert.strictEqual(full.stage.stageId, wonStage.id);
assert.strictEqual(full.remarks.length, 1);
assert.strictEqual(full.reminders.length, 1);
assert.deepStrictEqual(full.snoozeStatus, { snoozed: false });
assert.ok(Array.isArray(full.assignableUsers));

// Messages carry who actually sent them (roadmap: "Rahul replied," not just "Agent replied") and any attached media.
assert.strictEqual(full.messages[0].senderName, null, 'inbound messages have no senderUserId, so no sender name');
assert.strictEqual(full.messages[1].senderName, 'Agent');
assert.strictEqual(full.messages[0].media, null, 'a plain text message has no media');
assert.deepStrictEqual(full.messages[1].media, { mediaType: 'image', mediaUrl: 'https://example.com/photo.jpg', caption: 'A photo' });

// A VIEWER: remarks/reminders come back null (no access), not an error for the whole call.
email = 'viewer@example.com';
const viewerWorkspace = workspace().getConversationWorkspace(conversation.id);
assert.strictEqual(viewerWorkspace.conversation.id, conversation.id, 'the base detail still loads for a VIEWER with view access');
assert.strictEqual(viewerWorkspace.remarks, null, 'VIEWER has neither REMARKS_VIEW nor REMARKS_MANAGE');
assert.strictEqual(viewerWorkspace.reminders.length, 1, 'VIEWER has CONVERSATIONS_VIEW_AUTHORIZED, which requireReminderView_ accepts — read-only reminder visibility, same as remarks\' VIEW/MANAGE split conceptually, but reminders only ever checked conversation-view, not a reminder-specific permission');
assert.deepStrictEqual(viewerWorkspace.assignableUsers, [], 'VIEWER has no reassignment scope at all');

console.log('Workspace verification: PASS');

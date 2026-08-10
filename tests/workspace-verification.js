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
new MessageRepository().create({ id: 'message_1', conversationId: conversation.id, numberId: number.id, senderUserId: '', direction: 'INBOUND', messageType: 'text', messageText: 'Hi', providerMessageId: 'wamid.1', status: 'RECEIVED', timestamp: '' });

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
assert.strictEqual(full.messages.length, 1);
assert.strictEqual(full.stage.stageId, wonStage.id);
assert.strictEqual(full.remarks.length, 1);
assert.strictEqual(full.reminders.length, 1);
assert.deepStrictEqual(full.snoozeStatus, { snoozed: false });
assert.ok(Array.isArray(full.assignableUsers));

// A VIEWER: remarks/reminders come back null (no access), not an error for the whole call.
email = 'viewer@example.com';
const viewerWorkspace = workspace().getConversationWorkspace(conversation.id);
assert.strictEqual(viewerWorkspace.conversation.id, conversation.id, 'the base detail still loads for a VIEWER with view access');
assert.strictEqual(viewerWorkspace.remarks, null, 'VIEWER has neither REMARKS_VIEW nor REMARKS_MANAGE');
assert.strictEqual(viewerWorkspace.reminders.length, 1, 'VIEWER has CONVERSATIONS_VIEW_AUTHORIZED, which requireReminderView_ accepts — read-only reminder visibility, same as remarks\' VIEW/MANAGE split conceptually, but reminders only ever checked conversation-view, not a reminder-specific permission');
assert.deepStrictEqual(viewerWorkspace.assignableUsers, [], 'VIEWER has no reassignment scope at all');

console.log('Workspace verification: PASS');

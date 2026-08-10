/* Run with: node tests/phase5-inbox-verification.js */
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
const phase5 = () => new Phase5Api();

// Bootstrap and build a small org: two numbers, an agent with access to only one,
// a site manager owning a team scoped to the other number, and a conversation on each.
phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;

const agent = phase1().createUser({ email: 'agent@example.com', displayName: 'Agent', roleIds: [roleId('AGENT')] });
const manager = phase1().createUser({ email: 'manager@example.com', displayName: 'Manager', roleIds: [roleId('SITE_MANAGER')] });
const outsider = phase1().createUser({ email: 'outsider@example.com', displayName: 'Outsider', roleIds: [roleId('AGENT')] });

const numberA = new NumberRepository().create({ id: 'number_a', displayName: 'Sales 1', phoneNumber: '079-1', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
const numberB = new NumberRepository().create({ id: 'number_b', displayName: 'Sales 2', phoneNumber: '079-2', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

phase1().grantNumberAccess({ userId: agent.id, numberId: numberA.id });
phase1().grantNumberAccess({ userId: manager.id, numberId: numberB.id });

const team = phase1().createTeam({ name: 'Team B', ownerUserId: manager.id });
phase1().addTeamMember({ teamId: team.id, userId: manager.id, numberIds: [numberB.id] });

const customer = new CustomerRepository().create({ id: 'customer_1', phone: '+919999999999', name: 'Test Customer', email: '', company: '', source: 'whatsapp', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
const conversationA = new ConversationRepository().create({ id: 'conversation_a', customerId: customer.id, numberId: numberA.id, assignedUserId: agent.id, status: 'OPEN', needsResponse: true, lastMessageAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
const conversationB = new ConversationRepository().create({ id: 'conversation_b', customerId: customer.id, numberId: numberB.id, assignedUserId: '', status: 'OPEN', needsResponse: true, lastMessageAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
new MessageRepository().create({ id: 'message_1', conversationId: conversationA.id, numberId: numberA.id, senderUserId: '', direction: 'INBOUND', messageType: 'text', messageText: 'Hi', providerMessageId: 'wamid.1', status: 'RECEIVED', timestamp: '2026-01-01T00:00:00.000Z' });

// ADMIN sees both numbers and both conversations.
email = 'admin@example.com';
assert.strictEqual(phase5().listMyNumbers().length, 2);
assert.strictEqual(phase5().listConversations(numberA.id).length, 1);
assert.strictEqual(phase5().listConversations(numberB.id).length, 1);
const adminDetail = phase5().getConversationDetail(conversationA.id);
assert.strictEqual(adminDetail.customer.id, customer.id);
assert.strictEqual(adminDetail.messages.length, 1);

// AGENT sees only their granted number, and only their own assigned conversation on it.
email = 'agent@example.com';
const agentNumbers = phase5().listMyNumbers();
assert.strictEqual(agentNumbers.length, 1);
assert.strictEqual(agentNumbers[0].id, numberA.id);
assert.strictEqual(phase5().listConversations(numberA.id).length, 1);
assert.throws(() => phase5().listConversations(numberB.id), error => error.code === 'FORBIDDEN');

// An AGENT with access to a number but not assigned to a conversation on it sees nothing there.
email = 'admin@example.com';
phase1().grantNumberAccess({ userId: outsider.id, numberId: numberA.id });
email = 'outsider@example.com';
assert.strictEqual(phase5().listConversations(numberA.id).length, 0);
assert.throws(() => phase5().getConversationDetail(conversationA.id), error => error.code === 'FORBIDDEN');

// SITE_MANAGER sees the conversation on the number their team covers.
email = 'manager@example.com';
assert.strictEqual(phase5().listMyNumbers().length, 1);
assert.strictEqual(phase5().listConversations(numberB.id).length, 1);
// ...but not a number they have no team/number-access relationship to at all.
assert.throws(() => phase5().listConversations(numberA.id), error => error.code === 'FORBIDDEN');

// A resolved (CLOSED) conversation leaves the active list, same as a snoozed one, but
// is still findable via listConversationsAllStatuses (used by Phase 13's search).
email = 'admin@example.com';
new ConversationRepository().update(conversationA.id, { status: 'CLOSED' });
assert.strictEqual(phase5().listConversations(numberA.id).length, 0);
assert.strictEqual(phase5().listConversationsAllStatuses(numberA.id).length, 1);
assert.strictEqual(phase5().listConversationsAllStatuses(numberA.id)[0].status, 'CLOSED');
new ConversationRepository().update(conversationA.id, { status: 'OPEN' });

console.log('Phase 5 inbox verification: PASS');

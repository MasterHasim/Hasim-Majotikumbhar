/* Run with: node tests/phase14-dashboard-verification.js */
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
const phase14 = () => new Phase14Api();
const forbidden = fn => assert.throws(fn, error => error && error.code === 'FORBIDDEN');

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;

const agent = phase1().createUser({ email: 'agent@example.com', displayName: 'Agent', roleIds: [roleId('AGENT')] });
const viewer = phase1().createUser({ email: 'viewer@example.com', displayName: 'Viewer', roleIds: [roleId('VIEWER')] });

const number = new NumberRepository().create({ id: 'number_1', displayName: 'Sales 1', phoneNumber: '079-1', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '', updatedAt: '' });
const customer1 = new CustomerRepository().create({ id: 'customer_1', phone: '+919000000001', name: 'Customer One', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
const customer2 = new CustomerRepository().create({ id: 'customer_2', phone: '+919000000002', name: 'Customer Two', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });

// conv1: assigned, replied 10 minutes after creation.
const conv1 = new ConversationRepository().create({ id: 'conversation_1', customerId: customer1.id, numberId: number.id, assignedUserId: agent.id, status: 'OPEN', needsResponse: false, lastMessageAt: '', createdAt: '2026-08-10T09:00:00.000Z', updatedAt: '' });
new MessageRepository().create({ id: 'message_1', conversationId: conv1.id, numberId: number.id, senderUserId: '', direction: 'INBOUND', messageType: 'text', messageText: 'Hi', providerMessageId: 'wamid.1', status: 'RECEIVED', timestamp: '2026-08-10T09:00:00.000Z' });
new MessageRepository().create({ id: 'message_2', conversationId: conv1.id, numberId: number.id, senderUserId: agent.id, direction: 'OUTBOUND', messageType: 'text', messageText: 'Hello!', providerMessageId: '', status: 'SENT', timestamp: '2026-08-10T09:10:00.000Z' });
new MessageRepository().create({ id: 'message_3', conversationId: conv1.id, numberId: number.id, senderUserId: agent.id, direction: 'OUTBOUND', messageType: 'template', messageText: '[Template: order_update]', providerMessageId: '', status: 'SENT', timestamp: '2026-08-10T09:11:00.000Z' });

// conv2: unassigned, needs response, no reply yet.
const conv2 = new ConversationRepository().create({ id: 'conversation_2', customerId: customer2.id, numberId: number.id, assignedUserId: '', status: 'OPEN', needsResponse: true, lastMessageAt: '', createdAt: '2026-08-10T10:00:00.000Z', updatedAt: '' });
new MessageRepository().create({ id: 'message_4', conversationId: conv2.id, numberId: number.id, senderUserId: '', direction: 'INBOUND', messageType: 'text', messageText: 'Hello?', providerMessageId: 'wamid.2', status: 'RECEIVED', timestamp: '2026-08-10T10:00:00.000Z' });

phase8().seedDefaultLeadStages();
const stages = phase8().listStages();
const contactedStage = stages.find(s => s.key === 'contacted');
const wonStage = stages.find(s => s.key === 'won');
phase8().setCustomerStage(customer1.id, wonStage.id);
phase8().setCustomerStage(customer2.id, contactedStage.id);

// AGENT lacks REPORTS_VIEW.
email = 'agent@example.com';
forbidden(() => phase14().getDashboardMetrics());

// VIEWER has REPORTS_VIEW.
email = 'viewer@example.com';
const metrics = phase14().getDashboardMetrics();
assert.strictEqual(metrics.conversations.total, 2);
assert.strictEqual(metrics.conversations.open, 2);
assert.strictEqual(metrics.conversations.unassigned, 1);
assert.strictEqual(metrics.conversations.needsResponse, 1);
assert.strictEqual(metrics.conversations.resolved, 0, 'no phase has ever added a close-conversation workflow, so this is always 0 today');

assert.strictEqual(metrics.byNumber.length, 1);
assert.strictEqual(metrics.byNumber[0].total, 2);

assert.strictEqual(metrics.byAgent.length, 1, 'only agents with at least one open/needs-response conversation are listed');
assert.strictEqual(metrics.byAgent[0].userId, agent.id);
assert.strictEqual(metrics.byAgent[0].open, 1);

assert.strictEqual(metrics.responseTime.sampleSize, 1, 'only conv1 has an OUTBOUND reply');
assert.strictEqual(metrics.responseTime.averageFirstResponseMinutes, 10);

const templateRow = metrics.templateUsage.find(t => t.name === 'order_update');
assert.ok(templateRow);
assert.strictEqual(templateRow.count, 1);

const stageRow = metrics.stageDistribution.find(s => s.stageId === wonStage.id);
assert.strictEqual(stageRow.count, 1);

assert.strictEqual(metrics.leadConversion.totalCustomersWithStage, 2);
assert.strictEqual(metrics.leadConversion.wonCount, 1);
assert.strictEqual(metrics.leadConversion.conversionRate, 50);

// ADMIN (has every permission) also sees the dashboard.
email = 'admin@example.com';
assert.strictEqual(phase14().getDashboardMetrics().conversations.total, 2);

console.log('Phase 14 dashboard verification: PASS');

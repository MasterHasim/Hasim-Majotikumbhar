/* Run with: node tests/phase9-reminders-verification.js */
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
const phase9 = () => new Phase9Api();
const forbidden = fn => assert.throws(fn, error => error && error.code === 'FORBIDDEN');

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;
const agent = phase1().createUser({ email: 'agent@example.com', displayName: 'Agent', roleIds: [roleId('AGENT')] });
const viewer = phase1().createUser({ email: 'viewer@example.com', displayName: 'Viewer', roleIds: [roleId('VIEWER')] });

const number = new NumberRepository().create({ id: 'number_1', displayName: 'Sales 1', phoneNumber: '079-1', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '', updatedAt: '' });
const customer = new CustomerRepository().create({ id: 'customer_1', phone: '+919999999999', name: 'Test Customer', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
const conversation = new ConversationRepository().create({ id: 'conversation_1', customerId: customer.id, numberId: number.id, assignedUserId: agent.id, status: 'OPEN', needsResponse: true, lastMessageAt: '', createdAt: '', updatedAt: '' });

phase1().grantNumberAccess({ userId: agent.id, numberId: number.id });
phase1().grantNumberAccess({ userId: viewer.id, numberId: number.id });

// AGENT (assigned) can create a reminder; VIEWER (no REMINDERS_MANAGE) cannot.
email = 'agent@example.com';
const reminder = phase9().createReminder(conversation.id, 'Follow up on quotation', '2026-08-15T10:00:00.000Z');
assert.strictEqual(reminder.status, 'PENDING');
assert.strictEqual(reminder.ownerUserId, agent.id);

email = 'viewer@example.com';
forbidden(() => phase9().createReminder(conversation.id, 'Trying to add one', '2026-08-15T10:00:00.000Z'));
// VIEWER can still list reminders (view-only access is enough for listing).
assert.strictEqual(phase9().listReminders(conversation.id).length, 1);

// Completing a reminder; invalid status is rejected.
email = 'agent@example.com';
const completed = phase9().updateReminderStatus(reminder.id, 'COMPLETED');
assert.strictEqual(completed.status, 'COMPLETED');
assert.throws(() => phase9().updateReminderStatus(reminder.id, 'NOT_A_REAL_STATUS'), error => error.code === 'VALIDATION_ERROR');

// listMyReminders only returns the caller's own PENDING reminders.
const secondReminder = phase9().createReminder(conversation.id, 'Second follow-up', '2026-08-16T10:00:00.000Z');
const myReminders = phase9().listMyReminders();
assert.strictEqual(myReminders.length, 1);
assert.strictEqual(myReminders[0].id, secondReminder.id);

// numberId (2026-08-10, user-directed): scopes to reminders on that one number's
// conversations, so switching between numbers in the UI doesn't blend reminders.
const otherNumber = new NumberRepository().create({ id: 'number_2', displayName: 'Sales 2', phoneNumber: '079-2', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '', updatedAt: '' });
email = 'admin@example.com';
phase1().grantNumberAccess({ userId: agent.id, numberId: otherNumber.id });
email = 'agent@example.com';
const otherConversation = new ConversationRepository().create({ id: 'conversation_2', customerId: customer.id, numberId: otherNumber.id, assignedUserId: agent.id, status: 'OPEN', needsResponse: true, lastMessageAt: '', createdAt: '', updatedAt: '' });
const otherNumberReminder = phase9().createReminder(otherConversation.id, 'Reminder on the other number', '2026-08-17T10:00:00.000Z');
assert.strictEqual(phase9().listMyReminders(number.id).length, 1);
assert.strictEqual(phase9().listMyReminders(number.id)[0].id, secondReminder.id);
assert.strictEqual(phase9().listMyReminders(otherNumber.id).length, 1);
assert.strictEqual(phase9().listMyReminders(otherNumber.id)[0].id, otherNumberReminder.id);
assert.strictEqual(phase9().listMyReminders().length, 2, 'no numberId still returns everything');

// Snooze: excludes the conversation from Phase 5's active list until it expires.
assert.strictEqual(phase5().listConversations(number.id).length, 1);
const future = new Date(Date.now() + 3600000).toISOString();
phase9().snoozeConversation(conversation.id, future);
assert.deepStrictEqual(phase9().getSnoozeStatus(conversation.id), { snoozed: true, snoozedUntil: future });
assert.strictEqual(phase5().listConversations(number.id).length, 0, 'snoozed conversation should be hidden from the active list');

// A snooze that already expired no longer hides the conversation.
const past = new Date(Date.now() - 3600000).toISOString();
phase9().snoozeConversation(conversation.id, past);
assert.strictEqual(phase9().getSnoozeStatus(conversation.id).snoozed, false);
assert.strictEqual(phase5().listConversations(number.id).length, 1);

// Explicit unsnooze also clears it.
phase9().snoozeConversation(conversation.id, future);
phase9().unsnoozeConversation(conversation.id);
assert.strictEqual(phase9().getSnoozeStatus(conversation.id).snoozed, false);
assert.strictEqual(phase5().listConversations(number.id).length, 1);

console.log('Phase 9 reminders/snooze verification: PASS');

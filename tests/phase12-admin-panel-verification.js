/* Run with: node tests/phase12-admin-panel-verification.js */
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
const phase7 = () => new Phase7Api();
const phase12 = () => new Phase12Api();
const forbidden = fn => assert.throws(fn, error => error && error.code === 'FORBIDDEN');

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;

const number = new NumberRepository().create({ id: 'number_1', displayName: 'Sales 1', phoneNumber: '079-1', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '', updatedAt: '' });
const rahul = phase1().createUser({ email: 'rahul@example.com', displayName: 'Rahul', roleIds: [roleId('AGENT')] });
const priya = phase1().createUser({ email: 'priya@example.com', displayName: 'Priya', roleIds: [roleId('AGENT')] });

// --- whoAmI ---
const me = phase1().whoAmI();
assert.deepStrictEqual(me.roleKeys, ['ADMIN']);

// --- Assignment config: ADMIN-only, upserts. ---
forbidden(() => { email = 'rahul@example.com'; phase12().setNumberAssignmentConfig(number.id, { roundRobinEnabled: true }); });
email = 'admin@example.com';
assert.strictEqual(phase12().getNumberAssignmentConfig(number.id), null);
const config = phase12().setNumberAssignmentConfig(number.id, { roundRobinEnabled: true, workingHoursStart: '09:00', workingHoursEnd: '18:00' });
assert.strictEqual(config.roundRobinEnabled, true);
assert.strictEqual(config.numberId, number.id);
const configAgain = phase12().setNumberAssignmentConfig(number.id, { fallbackUserId: priya.id });
assert.strictEqual(configAgain.id, config.id, 'a second call should update the existing config, not create a duplicate');
assert.strictEqual(configAgain.fallbackUserId, priya.id);
assert.strictEqual(configAgain.roundRobinEnabled, true, 'fields not in the patch are preserved');
assert.throws(() => phase12().setNumberAssignmentConfig(number.id, { lastAssignedUserId: 'x' }), error => error.code === 'VALIDATION_ERROR');
assert.throws(() => phase12().setNumberAssignmentConfig('missing-number', { roundRobinEnabled: true }), error => error.code === 'NOT_FOUND');

// --- Assignment participants: add/list/update, ADMIN-only. ---
forbidden(() => { email = 'rahul@example.com'; phase12().addAssignmentParticipant(number.id, rahul.id, 1); });
email = 'admin@example.com';
const participant1 = phase12().addAssignmentParticipant(number.id, rahul.id, 1);
phase12().addAssignmentParticipant(number.id, priya.id, 2);
assert.throws(() => phase12().addAssignmentParticipant(number.id, rahul.id, 3), error => error.code === 'CONFLICT');
const participants = phase12().listAssignmentParticipants(number.id);
assert.strictEqual(participants.length, 2);
assert.strictEqual(participants[0].userId, rahul.id);
const updatedParticipant = phase12().updateAssignmentParticipant(participant1.id, { active: false });
assert.strictEqual(updatedParticipant.active, false);
assert.throws(() => phase12().updateAssignmentParticipant(participant1.id, { userId: 'nope' }), error => error.code === 'VALIDATION_ERROR');

// --- Dashboard summary: ADMIN-only counts. ---
forbidden(() => { email = 'rahul@example.com'; phase12().getDashboardSummary(); });
email = 'admin@example.com';
const customer = new CustomerRepository().create({ id: 'customer_1', phone: '+919999999999', name: '', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
new ConversationRepository().create({ id: 'conversation_1', customerId: customer.id, numberId: number.id, assignedUserId: '', status: 'OPEN', needsResponse: true, lastMessageAt: '', createdAt: '', updatedAt: '' });
const summary = phase12().getDashboardSummary();
assert.strictEqual(summary.numbers, 1);
assert.strictEqual(summary.users, 3); // admin + rahul + priya
assert.strictEqual(summary.openConversations, 1);
assert.strictEqual(summary.unassigned, 1);
assert.strictEqual(summary.needsResponse, 1);

// --- Phase 7: listAssignableUsers, properly role-scoped. ---
email = 'admin@example.com';
const adminList = phase7().listAssignableUsers(number.id);
assert.strictEqual(adminList.length, 3, 'ADMIN sees every active user');

// A SUPERVISOR with no team covering this number is denied.
const supervisor = phase1().createUser({ email: 'supervisor@example.com', displayName: 'Supervisor', roleIds: [roleId('SUPERVISOR')] });
email = 'supervisor@example.com';
forbidden(() => phase7().listAssignableUsers(number.id));

// Once the supervisor is on a team scoped to this number, they see that team's active members.
email = 'admin@example.com';
const manager = phase1().createUser({ email: 'manager@example.com', displayName: 'Manager', roleIds: [roleId('SITE_MANAGER')] });
const team = phase1().createTeam({ name: 'Team 1', ownerUserId: manager.id });
phase1().addTeamMember({ teamId: team.id, userId: supervisor.id, numberIds: [number.id] });
phase1().addTeamMember({ teamId: team.id, userId: rahul.id, numberIds: [number.id] });

email = 'supervisor@example.com';
const teamList = phase7().listAssignableUsers(number.id);
assert.strictEqual(teamList.length, 2, 'supervisor + rahul, both active members of the team scoped to this number');
assert.ok(teamList.some(u => u.id === rahul.id));

// A plain AGENT (no team-scope path at all) is denied.
email = 'rahul@example.com';
forbidden(() => phase7().listAssignableUsers(number.id));

console.log('Phase 12 admin panel verification: PASS');

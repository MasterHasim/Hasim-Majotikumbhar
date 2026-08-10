/* Run with: node tests/phase1-role-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const store = { 'wap.phase1.bootstrapAdminEmail': 'admin@example.com', SPREADSHEET_ID: 'mock-spreadsheet-id' };
let email = 'admin@example.com';
global.Utilities = { getUuid: (() => { let n = 0; return () => String(++n); })() };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: key => store[key] || null, setProperty: (key, value) => { store[key] = value; } }) };
global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
global.Session = { getActiveUser: () => ({ getEmail: () => email }) };

// AuditLogService (Phase1Services.gs) now writes to AuditLogRepository (Phase 2's
// Sheets-backed SheetRepository) instead of PropertiesRepository, so this test needs
// every src file loaded (not just the Phase1*.gs ones) plus a SpreadsheetApp mock.
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
const sheetsByName = {};
global.SpreadsheetApp = { openById: () => ({ getSheetByName: name => sheetsByName[name] || null, insertSheet: name => { const sheet = makeSheet(); sheetsByName[name] = sheet; return sheet; } }) };

const srcDir = path.join(__dirname, '..', 'src');
fs.readdirSync(srcDir).filter(file => file.endsWith('.gs')).sort().forEach(file => {
  vm.runInThisContext(fs.readFileSync(path.join(srcDir, file), 'utf8'), { filename: file });
});

const api = () => new Phase1Api();
const forbidden = fn => assert.throws(fn, error => error && error.code === 'FORBIDDEN');
const unauthenticated = fn => assert.throws(fn, error => error && error.code === 'UNAUTHENTICATED');

api().bootstrap({ email, displayName: 'Admin' });
const roles = api().listRoles();
assert.deepStrictEqual(roles.map(role => role.key).sort(), ['ADMIN', 'AGENT', 'SITE_MANAGER', 'SUPERVISOR', 'VIEWER']);
const roleId = key => roles.find(role => role.key === key).id;
const create = (address, role) => api().createUser({ email: address, displayName: address, roleIds: [roleId(role)] });
const supervisor = create('supervisor@example.com', 'SUPERVISOR');
const managerA = create('manager-a@example.com', 'SITE_MANAGER');
const managerB = create('manager-b@example.com', 'SITE_MANAGER');
const agentA = create('agent-a@example.com', 'AGENT');
const agentB = create('agent-b@example.com', 'AGENT');
const viewer = create('viewer@example.com', 'VIEWER');
api().createUser({ email: 'inactive@example.com', displayName: 'Inactive', status: 'inactive', roleIds: [roleId('AGENT')] });
api().createUser({ email: 'suspended@example.com', displayName: 'Suspended', status: 'suspended', roleIds: [roleId('AGENT')] });
const teamA = api().createTeam({ name: 'Team A', ownerUserId: managerA.id });
const teamB = api().createTeam({ name: 'Team B', ownerUserId: managerB.id });
[supervisor, agentA, agentB].forEach(user => api().addTeamMember({ teamId: teamA.id, userId: user.id, numberIds: ['number-a'] }));
api().addTeamMember({ teamId: teamB.id, userId: managerB.id, numberIds: ['number-b'] });
assert.strictEqual(api().listTeamMembers(teamA.id).length, 3);
[supervisor, managerA, managerB, agentA, agentB, viewer].forEach(user => api().grantNumberAccess({ userId: user.id, numberId: user === managerB ? 'number-b' : 'number-a' }));

// ADMIN global operations.
assert.ok(api().listUsers().length >= 8);
assert.ok(api().listNumberAccess().length >= 6);
// ADMIN has global reply/reassign scope too, not just view (regression: these action
// branches originally had no ADMIN bypass, unlike 'view').
assert.ok(api().access_.requireConversationOperation('reply', { numberId: 'number-a', teamId: null, assignedUserId: agentA.id }));
assert.ok(api().access_.requireConversationOperation('reassign', { numberId: 'number-a', teamId: null, assignedUserId: agentA.id }));

// SUPERVISOR cannot administer users, settings, or number grants, but can view an assigned team.
email = 'supervisor@example.com';
forbidden(() => api().createUser({ email: 'blocked@example.com', displayName: 'Blocked', roleIds: [] }));
forbidden(() => api().grantNumberAccess({ userId: supervisor.id, numberId: 'number-x' }));
forbidden(() => api().access_.require(Phase1Permissions.SETTINGS_MANAGE));
assert.ok(api().access_.requireConversationOperation('view', { numberId: 'number-a', teamId: teamA.id, assignedUserId: agentA.id }));

// SITE_MANAGER cannot use another team's restricted operations.
email = 'manager-a@example.com';
forbidden(() => api().access_.requireConversationOperation('view', { numberId: 'number-b', teamId: teamB.id, assignedUserId: agentB.id }));
api().setAssignmentEligibility({ userId: agentA.id, numberId: 'number-a', teamId: teamA.id, eligible: true });

// AGENT cannot view another user's assigned conversation or manage a team.
email = 'agent-a@example.com';
api().setAvailability('busy');
assert.deepStrictEqual(api().getAssignmentEligibility(agentA.id, 'number-a').assignableNow, false);
forbidden(() => api().access_.requireConversationOperation('view', { numberId: 'number-a', teamId: teamA.id, assignedUserId: agentB.id }));
forbidden(() => api().createTeam({ name: 'Blocked', ownerUserId: managerA.id }));
assert.ok(api().access_.requireConversationOperation('reply', { numberId: 'number-a', teamId: teamA.id, assignedUserId: agentA.id }));

// VIEWER cannot reply or reassign; a manually altered frontend number is still denied server-side.
email = 'viewer@example.com';
forbidden(() => api().access_.requireConversationOperation('reply', { numberId: 'number-a', teamId: teamA.id, assignedUserId: agentA.id }));
forbidden(() => api().access_.requireConversationOperation('reassign', { numberId: 'number-a', teamId: teamA.id, assignedUserId: agentA.id }));
forbidden(() => api().access_.requireConversationOperation('view', { numberId: 'frontend-forged-number', teamId: teamA.id, assignedUserId: agentA.id }));

// Inactive, suspended, unknown, and anonymous identities cannot authenticate.
email = 'inactive@example.com'; unauthenticated(() => api().access_.currentUser());
email = 'suspended@example.com'; unauthenticated(() => api().access_.currentUser());
email = 'unknown@example.com'; unauthenticated(() => api().access_.currentUser());
email = ''; unauthenticated(() => api().access_.currentUser());

console.log('Phase 1 role and security verification: PASS');

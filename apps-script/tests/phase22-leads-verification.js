/* Run with: node tests/phase22-leads-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = {
  SPREADSHEET_ID: 'mock-spreadsheet-id', 'wap.phase1.bootstrapAdminEmail': 'admin@example.com',
  EXOTEL_VOICE_ACCOUNT_SID: 'sid', EXOTEL_VOICE_API_KEY: 'key', EXOTEL_VOICE_API_TOKEN: 'token', EXOTEL_VOICE_CALLER_ID: '07900000000'
};
let email = 'admin@example.com';
global.Utilities = { getUuid: (() => { let n = 0; return () => String(++n); })(), base64Encode: str => Buffer.from(str).toString('base64') };
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

let nextCallSid = 0;
global.UrlFetchApp = {
  fetch: (url) => {
    if (url.indexOf('api.exotel.com') !== -1) {
      nextCallSid++;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ Call: { Sid: 'call_sid_' + nextCallSid, Status: 'in-progress' } }) };
    }
    return { getResponseCode: () => 400, getContentText: () => 'unhandled request in mock' };
  }
};

const srcDir = path.join(__dirname, '..', 'src');
fs.readdirSync(srcDir).filter(file => file.endsWith('.gs')).sort().forEach(file => {
  vm.runInThisContext(fs.readFileSync(path.join(srcDir, file), 'utf8'), { filename: file });
});

const phase1 = () => new Phase1Api();
const phase22 = () => new Phase22Api();

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;

const rahul = phase1().createUser({ email: 'rahul@example.com', displayName: 'Rahul', roleIds: [roleId('AGENT')] });
const priya = phase1().createUser({ email: 'priya@example.com', displayName: 'Priya', roleIds: [roleId('AGENT')] });
phase1().updateUser(rahul.id, { phone: '9111111111' });

// Manual mode (no config yet) — lead lands UNASSIGNED.
const upload1 = phase22().uploadLeads([{ name: 'Lead One', phone: '9876543210', location: 'Raipur' }]);
assert.strictEqual(upload1.created, 1);
assert.strictEqual(upload1.skipped, 0);
const leadsAfterUpload1 = phase22().listLeads({});
assert.strictEqual(leadsAfterUpload1.length, 1);
assert.strictEqual(leadsAfterUpload1[0].status, 'UNASSIGNED');

// Duplicate phone+location in the same batch is skipped, not double-created.
const uploadDup = phase22().uploadLeads([{ name: 'Lead One Again', phone: '9876543210', location: 'Raipur' }]);
assert.strictEqual(uploadDup.created, 0);
assert.strictEqual(uploadDup.skipped, 1);

// Invalid row (bad phone) is reported, not thrown, and doesn't block the rest of the batch.
const uploadMixed = phase22().uploadLeads([{ name: 'Bad Phone', phone: 'abc', location: 'Raipur' }, { name: 'Good Row', phone: '9111111112', location: 'Rajsamand' }]);
assert.strictEqual(uploadMixed.created, 1);
assert.strictEqual(uploadMixed.errors.length, 1);

// Single mode always assigns the configured agent.
phase22().setLocationConfig('Coimbatore', { mode: 'single', singleUserId: rahul.id, active: true });
const uploadSingle = phase22().uploadLeads([{ name: 'Single Lead', phone: '9222222222', location: 'Coimbatore' }]);
assert.strictEqual(uploadSingle.created, 1);
const singleLead = phase22().listLeads({ location: 'Coimbatore' })[0];
assert.strictEqual(singleLead.assignedUserId, rahul.id);
assert.strictEqual(singleLead.status, 'ASSIGNED');

// Round robin rotates across the pool, wrapping around, mirroring Phase 7's selectNextAgent_.
phase22().setLocationConfig('Prayagraj', { mode: 'round_robin', active: true });
phase22().addLocationParticipant('Prayagraj', rahul.id, 1);
phase22().addLocationParticipant('Prayagraj', priya.id, 2);
const rrLead1 = phase22().uploadLeads([{ name: 'RR One', phone: '9300000001', location: 'Prayagraj' }]);
const rrLead2 = phase22().uploadLeads([{ name: 'RR Two', phone: '9300000002', location: 'Prayagraj' }]);
const rrLead3 = phase22().uploadLeads([{ name: 'RR Three', phone: '9300000003', location: 'Prayagraj' }]);
const rrLeads = phase22().listLeads({ location: 'Prayagraj' }).sort((a, b) => a.phone.localeCompare(b.phone));
assert.strictEqual(rrLeads[0].assignedUserId, rahul.id);
assert.strictEqual(rrLeads[1].assignedUserId, priya.id);
assert.strictEqual(rrLeads[2].assignedUserId, rahul.id, 'wraps back to Rahul');

// Manual reassignment overrides whatever the rule assigned.
const reassigned = phase22().reassignLead(rrLeads[0].id, priya.id);
assert.strictEqual(reassigned.assignedUserId, priya.id);
assert.strictEqual(reassigned.status, 'ASSIGNED');

// Role scoping: AGENT sees only their own leads via LEADS_VIEW_ASSIGNED, not everyone's.
email = 'rahul@example.com';
const rahulsLeads = phase22().listLeads({});
assert.ok(rahulsLeads.every(lead => lead.assignedUserId === rahul.id));
assert.ok(rahulsLeads.length > 0);

// Permission denial: AGENT cannot upload leads (LEADS_MANAGE is ADMIN/SITE_MANAGER only).
assert.throws(() => phase22().uploadLeads([{ name: 'X', phone: '9000000000', location: 'Alibaug' }]), error => error.code === 'FORBIDDEN');

// Click-to-call: only for a lead assigned to the calling agent.
const rahulsOwnLead = rahulsLeads.find(lead => lead.assignedUserId === rahul.id);
const call = phase22().initiateCall(rahulsOwnLead.id);
assert.strictEqual(call.agentPhone, '9111111111');
assert.ok(call.exotelCallSid.indexOf('call_sid_') === 0);
assert.strictEqual(phase22().listLeads({}).find(l => l.id === rahulsOwnLead.id).status, 'CALLED');

email = 'priya@example.com';
assert.throws(() => phase22().initiateCall(rahulsOwnLead.id), error => error.code === 'FORBIDDEN', 'a lead not assigned to the caller must be rejected');

console.log('Phase 22 leads verification: PASS');

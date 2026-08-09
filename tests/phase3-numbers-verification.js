/* Run with: node tests/phase3-numbers-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = { 'wap.phase1.bootstrapAdminEmail': 'admin@example.com', 'SPREADSHEET_ID': 'mock-spreadsheet-id' };
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
const phase3 = () => new Phase3Api();
const forbidden = fn => assert.throws(fn, error => error && error.code === 'FORBIDDEN');

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;
const agent = phase1().createUser({ email: 'agent@example.com', displayName: 'Agent', roleIds: [roleId('AGENT')] });

// ADMIN can register a number.
const number = phase3().createNumber({ displayName: 'Sales 1', phoneNumber: '079-485-02801', provider: 'exotel' });
assert.ok(number.id);
assert.strictEqual(number.providerAccountId, '');
assert.strictEqual(number.active, true);
assert.strictEqual(phase3().listNumbers().length, 1);

// Duplicate phone number is rejected.
assert.throws(() => phase3().createNumber({ displayName: 'Dup', phoneNumber: '079-485-02801', provider: 'exotel' }), error => error.code === 'CONFLICT');

// Update: valid field succeeds, unknown field is rejected.
const updated = phase3().updateNumber(number.id, { providerAccountId: 'acct-1' });
assert.strictEqual(updated.providerAccountId, 'acct-1');
assert.throws(() => phase3().updateNumber(number.id, { notAField: true }), error => error.code === 'VALIDATION_ERROR');
assert.throws(() => phase3().updateNumber('missing', { active: false }), error => error.code === 'NOT_FOUND');

// AGENT is denied every Phase 3 number operation.
email = 'agent@example.com';
forbidden(() => phase3().createNumber({ displayName: 'Blocked', phoneNumber: '079-485-02802', provider: 'exotel' }));
forbidden(() => phase3().listNumbers());
forbidden(() => phase3().updateNumber(number.id, { active: false }));

console.log('Phase 3 number-service verification: PASS');

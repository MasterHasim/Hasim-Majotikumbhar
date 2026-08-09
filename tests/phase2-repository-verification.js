/* Run with: node tests/phase2-repository-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = { 'SPREADSHEET_ID': 'mock-spreadsheet-id' };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) };
global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
global.Utilities = { getUuid: (() => { let n = 0; return () => String(++n); })() };

function makeSheet() {
  let rows = [];
  return {
    appendRow: values => { rows.push(values.slice()); },
    getDataRange: () => ({ getValues: () => rows.map(row => row.slice()) }),
    getRange: (rowIndex) => ({
      setValues: values => { rows[rowIndex - 1] = values[0].slice(); },
      setNumberFormat: () => {}
    }),
    getMaxRows: () => 1000,
    getLastRow: () => rows.length,
    deleteRow: rowIndex => { rows.splice(rowIndex - 1, 1); }
  };
}
function makeSpreadsheet() {
  const sheetsByName = {};
  return {
    getSheetByName: name => sheetsByName[name] || null,
    insertSheet: name => { const sheet = makeSheet(); sheetsByName[name] = sheet; return sheet; }
  };
}
const mockSpreadsheet = makeSpreadsheet();
global.SpreadsheetApp = { openById: () => mockSpreadsheet };

// Load every .gs file in filename-sorted order, matching how Apps Script actually
// concatenates project files at runtime (this caught a real load-order bug: a class
// declared `extends SheetRepository` at file-load time in a file that alphabetically
// preceded SheetRepository's own definition).
const srcDir = path.join(__dirname, '..', 'src');
fs.readdirSync(srcDir).filter(file => file.endsWith('.gs')).sort().forEach(file => {
  vm.runInThisContext(fs.readFileSync(path.join(srcDir, file), 'utf8'), { filename: file });
});

// Generic SheetRepository contract, exercised through NumberRepository.
const numbers = new NumberRepository();
assert.deepStrictEqual(numbers.list(), []);
assert.strictEqual(numbers.count(), 0);

const numberA = { id: 'number_1', displayName: 'Sales 1', phoneNumber: '079-485-02801', provider: 'exotel', providerAccountId: 'acct-1', wabaId: 'waba-1', providerNumberId: 'pn-1', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
numbers.create(numberA);
assert.throws(() => numbers.create(numberA), error => error.code === 'CONFLICT');
assert.strictEqual(numbers.count(), 1);
assert.deepStrictEqual(numbers.get('number_1'), numberA);
assert.strictEqual(numbers.findOne(record => record.displayName === 'Sales 1').id, 'number_1');

const updated = numbers.update('number_1', { active: false });
assert.strictEqual(updated.active, false);
assert.notStrictEqual(updated.updatedAt, numberA.updatedAt);
assert.strictEqual(numbers.get('number_1').active, false);
assert.throws(() => numbers.update('missing', { active: false }), error => error.code === 'NOT_FOUND');

numbers.replace('number_2', { id: 'number_2', displayName: 'Sales 2', phoneNumber: '079-485-02802', provider: 'exotel', providerAccountId: 'acct-1', wabaId: 'waba-1', providerNumberId: 'pn-2', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
assert.strictEqual(numbers.count(), 2);

numbers.remove('number_1');
assert.strictEqual(numbers.count(), 1);
assert.strictEqual(numbers.get('number_1'), null);
assert.throws(() => numbers.remove('number_1'), error => error.code === 'NOT_FOUND');

// Configuration guard: repository operations fail clearly when unconfigured.
delete properties['SPREADSHEET_ID'];
assert.throws(() => new NumberRepository().list(), error => error.code === 'CONFIGURATION_ERROR');
properties['SPREADSHEET_ID'] = 'mock-spreadsheet-id';

// All concrete repositories instantiate with their configured schema.
const access = new AccessRepository();
assert.deepStrictEqual(access.config.list(), []);
assert.deepStrictEqual(access.users.list(), []);
[CustomerRepository, ConversationRepository, AssignmentRepository, MessageRepository, RemarkRepository, ReminderRepository, StageRepository, TemplateRepository, QuickReplyRepository].forEach(RepositoryClass => {
  const repository = new RepositoryClass();
  assert.deepStrictEqual(repository.list(), []);
  assert.strictEqual(repository.count(), 0);
});

console.log('Phase 2 repository verification: PASS');

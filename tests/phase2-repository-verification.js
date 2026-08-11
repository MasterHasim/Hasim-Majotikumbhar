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

/* Run with: node tests/phase4-webhook-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = {
  SPREADSHEET_ID: 'mock-spreadsheet-id', WEBHOOK_SECRET_TOKEN: 'secret123',
  EXOTEL_API_KEY: 'key', EXOTEL_API_TOKEN: 'token', EXOTEL_ACCOUNT_SID: 'sid', EXOTEL_SUBDOMAIN: 'api.exotel.com'
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) };
global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
global.Utilities = { getUuid: (() => { let n = 0; return () => String(++n); })(), base64Encode: str => Buffer.from(str, 'utf8').toString('base64') };
global.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => '{}' }) };
global.ContentService = {
  MimeType: { JSON: 'JSON' },
  createTextOutput: text => ({ text: text, setMimeType: function () { return this; } })
};

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

new NumberRepository().create({ id: 'number_1', displayName: 'Sales 1', phoneNumber: '079-1', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: 'pn-1', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

const inboundPayload = { whatsapp: { messages: [{ id: 'wamid.1', from: '+919999999999', to: 'pn-1', content: { type: 'text', text: { body: 'Hi' } }, timestamp: '2026-08-09T00:00:00.000Z' }] } };

// Missing token: rejected, nothing written.
let response = JSON.parse(doPost({ parameter: {}, postData: { contents: JSON.stringify(inboundPayload) } }).text);
assert.strictEqual(response.status, 'error');
assert.strictEqual(response.message, 'unauthorized');
assert.strictEqual(new MessageRepository().list().length, 0);

// Wrong token: also rejected.
response = JSON.parse(doPost({ parameter: { token: 'wrong' }, postData: { contents: JSON.stringify(inboundPayload) } }).text);
assert.strictEqual(response.status, 'error');
assert.strictEqual(new MessageRepository().list().length, 0);

// Correct token, valid payload: ingested successfully.
response = JSON.parse(doPost({ parameter: { token: 'secret123' }, postData: { contents: JSON.stringify(inboundPayload) } }).text);
assert.strictEqual(response.status, 'ok');
assert.strictEqual(response.result.duplicate, false);
assert.strictEqual(new MessageRepository().list().length, 1);

// Same payload again: duplicate, no new message row.
response = JSON.parse(doPost({ parameter: { token: 'secret123' }, postData: { contents: JSON.stringify(inboundPayload) } }).text);
assert.strictEqual(response.result.duplicate, true);
assert.strictEqual(new MessageRepository().list().length, 1);

// Malformed JSON body: caught, reported as an error, nothing thrown out of doPost.
response = JSON.parse(doPost({ parameter: { token: 'secret123' }, postData: { contents: 'not json' } }).text);
assert.strictEqual(response.status, 'error');

console.log('Phase 4 webhook verification: PASS');

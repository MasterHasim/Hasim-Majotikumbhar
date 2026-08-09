/* Run with: node tests/phase3-exotel-config-status-verification.js
 * Confirms the status tab only ever writes property NAMES, never values. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = {
  SPREADSHEET_ID: 'mock-spreadsheet-id',
  EXOTEL_API_KEY: 'super-secret-key',
  EXOTEL_API_TOKEN: 'super-secret-token'
  // EXOTEL_ACCOUNT_SID / EXOTEL_SUBDOMAIN intentionally left unset
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) };

let writtenRows = null;
function makeSheet() {
  return {
    clear: () => { writtenRows = null; },
    getRange: (row, col, numRows, numCols) => ({ setValues: values => { writtenRows = values; } })
  };
}
function makeSpreadsheet() {
  const sheetsByName = {};
  return { getSheetByName: name => sheetsByName[name] || null, insertSheet: name => { const sheet = makeSheet(); sheetsByName[name] = sheet; return sheet; } };
}
global.SpreadsheetApp = { openById: () => makeSpreadsheet() };

const srcDir = path.join(__dirname, '..', 'src');
fs.readdirSync(srcDir).filter(file => file.endsWith('.gs')).sort().forEach(file => {
  vm.runInThisContext(fs.readFileSync(path.join(srcDir, file), 'utf8'), { filename: file });
});

const rows = refreshExotelConfigStatus();

// The two configured properties show YES, the two unset ones show NO.
assert.deepStrictEqual(rows, [
  ['Property', 'Configured'],
  ['EXOTEL_API_KEY', 'YES'],
  ['EXOTEL_API_TOKEN', 'YES'],
  ['EXOTEL_ACCOUNT_SID', 'NO'],
  ['EXOTEL_SUBDOMAIN', 'NO']
]);

// No secret value ever appears anywhere in the written output.
const serialized = JSON.stringify(rows);
assert.ok(!serialized.includes('super-secret-key'));
assert.ok(!serialized.includes('super-secret-token'));
assert.deepStrictEqual(writtenRows, rows);

console.log('Phase 3 Exotel config status verification: PASS');

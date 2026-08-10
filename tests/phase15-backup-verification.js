/* Run with: node tests/phase15-backup-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = { SPREADSHEET_ID: 'mock-spreadsheet-id', 'wap.phase1.bootstrapAdminEmail': 'admin@example.com' };
let email = 'admin@example.com';
global.Utilities = { getUuid: (() => { let n = 0; return () => String(++n); })(), formatDate: () => '2026-08-10 02:00' };
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
let copyCallCount = 0;
let lastCopyName = null;
function makeSpreadsheet() {
  const sheetsByName = {};
  return {
    getSheetByName: name => sheetsByName[name] || null,
    insertSheet: name => { const sheet = makeSheet(); sheetsByName[name] = sheet; return sheet; },
    getName: () => 'WhatsApp Panel Data',
    copy: name => { copyCallCount++; lastCopyName = name; return { getId: () => 'backup-file-' + copyCallCount, getUrl: () => 'https://drive.example/backup-' + copyCallCount }; }
  };
}
const mockSpreadsheet = makeSpreadsheet();
global.SpreadsheetApp = { openById: () => mockSpreadsheet };

let installedTriggers = [];
global.ScriptApp = {
  getProjectTriggers: () => installedTriggers,
  newTrigger: handlerFunction => ({
    timeBased: () => ({
      everyDays: () => ({
        atHour: () => ({
          create: () => { installedTriggers.push({ getHandlerFunction: () => handlerFunction }); }
        })
      })
    })
  }),
  deleteTrigger: trigger => { installedTriggers = installedTriggers.filter(t => t !== trigger); }
};

const srcDir = path.join(__dirname, '..', 'src');
fs.readdirSync(srcDir).filter(file => file.endsWith('.gs')).sort().forEach(file => {
  vm.runInThisContext(fs.readFileSync(path.join(srcDir, file), 'utf8'), { filename: file });
});

const phase1 = () => new Phase1Api();
const phase15 = () => new Phase15Api();
const forbidden = fn => assert.throws(fn, error => error && error.code === 'FORBIDDEN');

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;
const agent = phase1().createUser({ email: 'agent@example.com', displayName: 'Agent', roleIds: [roleId('AGENT')] });

// backupNow: ADMIN-only, creates a timestamped copy.
forbidden(() => { email = 'agent@example.com'; phase15().backupNow(); });
email = 'admin@example.com';
const backup = phase15().backupNow();
assert.strictEqual(copyCallCount, 1);
assert.ok(lastCopyName.indexOf('WhatsApp Panel Data') !== -1);
assert.ok(backup.id);
assert.ok(backup.url);

// Trigger status starts uninstalled.
assert.strictEqual(phase15().getBackupTriggerStatus().installed, false);

// Install: ADMIN-only, installs exactly one trigger even if called twice.
forbidden(() => { email = 'agent@example.com'; phase15().installDailyBackupTrigger(); });
email = 'admin@example.com';
phase15().installDailyBackupTrigger();
phase15().installDailyBackupTrigger();
assert.strictEqual(installedTriggers.length, 1, 'a second install should replace, not duplicate, the trigger');
assert.strictEqual(phase15().getBackupTriggerStatus().installed, true);

// Remove: ADMIN-only.
forbidden(() => { email = 'agent@example.com'; phase15().removeDailyBackupTrigger(); });
email = 'admin@example.com';
const removed = phase15().removeDailyBackupTrigger();
assert.strictEqual(removed.removed, 1);
assert.strictEqual(phase15().getBackupTriggerStatus().installed, false);

// The scheduled-backup trigger handler is a system operation — no signed-in identity
// required (mirrors Phase 4's webhook ingestion), unlike backupNow().
email = null; // simulate trigger-execution context: no active user at all
assert.doesNotThrow(() => runScheduledBackup());
assert.strictEqual(copyCallCount, 2);

console.log('Phase 15 backup verification: PASS');

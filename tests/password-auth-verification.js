/* Run with: node tests/password-auth-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');

const properties = { SPREADSHEET_ID: 'mock-spreadsheet-id', 'wap.phase1.bootstrapAdminEmail': 'admin@example.com' };
let email = 'admin@example.com';
global.Utilities = {
  getUuid: (() => { let n = 0; return () => String(++n); })(),
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  computeDigest: (algo, value) => Array.from(crypto.createHash('sha256').update(String(value), 'utf8').digest()),
  base64Encode: bytes => Buffer.from(bytes).toString('base64')
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) };
global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
global.Session = { getActiveUser: () => ({ getEmail: () => email }) };
global.ScriptApp = { getService: () => ({ getUrl: () => 'https://script.example/exec' }) };
let sentEmails = [];
global.MailApp = { sendEmail: (to, subject, body) => { sentEmails.push({ to, subject, body }); } };

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
global.SpreadsheetApp = { openById: () => makeSpreadsheet() };

const srcDir = path.join(__dirname, '..', 'src');
fs.readdirSync(srcDir).filter(file => file.endsWith('.gs')).sort().forEach(file => {
  vm.runInThisContext(fs.readFileSync(path.join(srcDir, file), 'utf8'), { filename: file });
});

const phase1 = () => new Phase1Api();
const auth = () => new PasswordAuthApi();

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(r => r.key === key).id;
const agent = phase1().createUser({ email: 'agent@example.com', displayName: 'Agent', roleIds: [roleId('AGENT')] });

// A user with no password set cannot log in — and the error doesn't reveal why.
assert.throws(() => auth().login('agent@example.com', 'whatever'), error => error.code === 'UNAUTHENTICATED');
// An unknown email gets the exact same generic error (no user enumeration).
assert.throws(() => auth().login('nobody@example.com', 'whatever'), error => error.code === 'UNAUTHENTICATED');

// Admin sends a setup link — captured via the MailApp mock, token extracted from the body.
email = 'admin@example.com';
auth().sendPasswordSetupLink(agent.id);
assert.strictEqual(sentEmails.length, 1);
assert.strictEqual(sentEmails[0].to, 'agent@example.com');
const setupToken = sentEmails[0].body.match(/resetToken=([^\s]+)/)[1];

// A non-admin cannot trigger someone else's setup link.
email = 'agent@example.com';
assert.throws(() => auth().sendPasswordSetupLink(agent.id), error => error.code === 'FORBIDDEN');

// Setting the password via the token, then logging in with it.
auth().resetPassword(setupToken, 'correct-horse-battery');
assert.throws(() => auth().resetPassword(setupToken, 'reused-token-should-fail'), error => error.code === 'NOT_FOUND'); // one-time use
assert.throws(() => auth().login('agent@example.com', 'wrong-password'), error => error.code === 'UNAUTHENTICATED');
const loggedIn = auth().login('agent@example.com', 'correct-horse-battery');
assert.ok(loggedIn.token);
assert.strictEqual(loggedIn.user.email, 'agent@example.com');
assert.strictEqual(loggedIn.user.passwordHash, undefined); // never sent to the client
assert.strictEqual(loggedIn.user.passwordSalt, undefined);

// resolveSession resolves a valid token, rejects garbage.
const resolved = auth().resolveSession(loggedIn.token);
assert.strictEqual(resolved.user.email, 'agent@example.com');
assert.strictEqual(auth().resolveSession('not-a-real-token'), null);

// callApi: the dispatcher correctly threads identity into a completely unmodified
// existing endpoint (whoAmI) — proves the session path produces the same result an
// AGENT would get via ordinary Google Sign-In.
email = 'someone-else@example.com'; // Session.getActiveUser() must NOT be what resolves identity here
const whoAmIResult = callApi(loggedIn.token, 'whoAmI', []);
assert.strictEqual(whoAmIResult.email, 'agent@example.com');

// callApi rejects anything not on the explicit allowlist (no arbitrary global-function invocation).
assert.throws(() => callApi(loggedIn.token, 'hashPassword_', ['x', 'y']), error => error.code === 'NOT_FOUND');
assert.throws(() => callApi(loggedIn.token, 'bootstrapPhase1', [{}]), error => error.code === 'NOT_FOUND');

// callApi rejects an invalid/expired token even for an allowlisted function.
assert.throws(() => callApi('not-a-real-token', 'whoAmI', []), error => error.code === 'UNAUTHENTICATED');

// logout invalidates the session.
auth().logout(loggedIn.token);
assert.throws(() => callApi(loggedIn.token, 'whoAmI', []), error => error.code === 'UNAUTHENTICATED');

// requestPasswordReset never reveals whether an email is registered.
sentEmails = [];
auth().requestPasswordReset('nobody@example.com');
assert.strictEqual(sentEmails.length, 0);
auth().requestPasswordReset('agent@example.com');
assert.strictEqual(sentEmails.length, 1);

// listUsers() never leaks password hashes to the client.
email = 'admin@example.com';
const users = phase1().listUsers();
users.forEach(u => { assert.strictEqual(u.passwordHash, undefined); assert.strictEqual(u.passwordSalt, undefined); });

console.log('Password auth verification: PASS');

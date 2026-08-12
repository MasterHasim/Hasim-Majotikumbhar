/* Run with: node tests/realtime-listen-verification.js
 * Verifies the minted custom token has the shape Firebase's signInWithCustomToken
 * expects and is scoped to exactly the numbers the caller has access to — it cannot
 * prove Firebase itself accepts the token or that the security rules (set by the
 * user in the Firebase console, not by this code) actually enforce the claim
 * correctly, since that needs live credentials and a live rules deployment. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const serviceAccount = { client_email: 'test@example.iam.gserviceaccount.com', private_key: 'fake-key-not-real-pem' };
const properties = {
  SPREADSHEET_ID: 'mock-spreadsheet-id',
  FIREBASE_DATABASE_URL: 'https://example-default-rtdb.asia-southeast1.firebasedatabase.app',
  FIREBASE_SERVICE_ACCOUNT_B64: Buffer.from(JSON.stringify(serviceAccount)).toString('base64'),
  FIREBASE_WEB_API_KEY: 'AIzaFakeWebApiKeyForTests',
  'wap.phase1.bootstrapAdminEmail': 'admin@example.com'
};
let email = 'admin@example.com';
global.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; }, deleteProperty: key => { delete properties[key]; } }) };
global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
global.Session = { getActiveUser: () => ({ getEmail: () => email }) };
global.Utilities = {
  getUuid: (() => { let n = 0; return () => String(++n); })(),
  base64Decode: str => Buffer.from(str, 'base64'),
  base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  newBlob: (data, contentType, name) => { const bytes = Buffer.isBuffer(data) || Array.isArray(data) ? Buffer.from(data) : Buffer.from(String(data), 'utf8'); return { bytes, mimeType: contentType, filename: name, getBytes: () => bytes, getDataAsString: () => bytes.toString('utf8') }; },
  computeRsaSha256Signature: (input, key) => Buffer.from('signed:' + input.length + ':' + key.length)
};
global.UrlFetchApp = {
  fetch: (url) => {
    if (url.indexOf('oauth2.googleapis.com') !== -1) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ access_token: 'mock-token', expires_in: 3600 }) };
    return { getResponseCode: () => 200, getContentText: () => 'null' };
  }
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

function decodeJwtPart(part) {
  const padded = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

const phase1 = () => new Phase1Api();
const realtime = () => new RealtimeListenApi();

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(r => r.key === key).id;
const agent = phase1().createUser({ email: 'agent@example.com', displayName: 'Agent', roleIds: [roleId('AGENT')] });

const numberA = new NumberRepository().create({ id: 'number_a', displayName: 'Sales A', phoneNumber: '+911111111111', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
const numberB = new NumberRepository().create({ id: 'number_b', displayName: 'Sales B', phoneNumber: '+922222222222', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
email = 'admin@example.com';
phase1().grantNumberAccess({ userId: agent.id, numberId: numberA.id }); // agent only granted number_a, not number_b

// The token has the standard 3-segment JWT shape.
email = 'agent@example.com';
const result = realtime().getRealtimeListenToken();
assert.strictEqual(result.databaseUrl, properties.FIREBASE_DATABASE_URL);
assert.strictEqual(result.webApiKey, properties.FIREBASE_WEB_API_KEY);
const parts = result.token.split('.');
assert.strictEqual(parts.length, 3);

const header = decodeJwtPart(parts[0]);
assert.strictEqual(header.alg, 'RS256');

const payload = decodeJwtPart(parts[1]);
assert.strictEqual(payload.iss, serviceAccount.client_email);
assert.strictEqual(payload.sub, serviceAccount.client_email);
assert.strictEqual(payload.aud, 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
assert.strictEqual(payload.uid, agent.id);
assert.ok(payload.exp > payload.iat);
assert.ok(payload.exp - payload.iat <= 3600); // Firebase custom tokens can't exceed 1 hour

// Scoped correctly: only the number this agent was actually granted, not every number.
assert.deepStrictEqual(payload.claims.numberIds, { number_a: true });

// ADMIN gets every number, not just explicitly granted ones (matches listMyNumbers()).
email = 'admin@example.com';
const adminResult = realtime().getRealtimeListenToken();
const adminPayload = decodeJwtPart(adminResult.token.split('.')[1]);
assert.deepStrictEqual(adminPayload.claims.numberIds, { number_a: true, number_b: true });

// Config guard: a clear error, not a confusing failure, if the Web API Key isn't set.
delete properties.FIREBASE_WEB_API_KEY;
assert.throws(() => realtime().getRealtimeListenToken(), error => error.code === 'CONFIGURATION_ERROR');

console.log('Realtime listen verification: PASS');

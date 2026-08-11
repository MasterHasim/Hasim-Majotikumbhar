/* Run with: node tests/phase7-assignment-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = { SPREADSHEET_ID: 'mock-spreadsheet-id', 'wap.phase1.bootstrapAdminEmail': 'admin@example.com' };
let email = 'admin@example.com';
let fakeTime = '12:00';
global.Utilities = { getUuid: (() => { let n = 0; return () => String(++n); })(), formatDate: () => fakeTime };
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

const phase1 = () => new Phase1Api();
const phase7 = () => new Phase7Api();
let seq = 0;
const newConversation = (customerId, numberId) => {
  seq++;
  return new ConversationRepository().create({
    id: 'conversation_' + seq, customerId: customerId, numberId: numberId, assignedUserId: '', status: 'OPEN', needsResponse: true,
    lastMessageAt: '2026-01-0' + seq + 'T00:00:00.000Z', createdAt: '2026-01-0' + seq + 'T00:00:00.000Z', updatedAt: '2026-01-0' + seq + 'T00:00:00.000Z'
  });
};

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;

const number = new NumberRepository().create({ id: 'number_1', displayName: 'Sales 1', phoneNumber: '079-1', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

const rahul = phase1().createUser({ email: 'rahul@example.com', displayName: 'Rahul', roleIds: [roleId('AGENT')] });
const priya = phase1().createUser({ email: 'priya@example.com', displayName: 'Priya', roleIds: [roleId('AGENT')] });
const amit = phase1().createUser({ email: 'amit@example.com', displayName: 'Amit', roleIds: [roleId('AGENT')] }); // deliberately left ineligible below
const manager = phase1().createUser({ email: 'manager@example.com', displayName: 'Manager', roleIds: [roleId('SITE_MANAGER')] });
const team = phase1().createTeam({ name: 'Team 1', ownerUserId: manager.id });

[rahul, priya, amit].forEach(user => phase1().grantNumberAccess({ userId: user.id, numberId: number.id }));
[rahul, priya, amit].forEach(user => phase1().setUserAvailability(user.id, 'available'));
new AccessRepository().users.create({ id: 'nau_1', numberId: number.id, userId: rahul.id, sequenceOrder: 1, active: true, createdAt: '', updatedAt: '' });
new AccessRepository().users.create({ id: 'nau_2', numberId: number.id, userId: priya.id, sequenceOrder: 2, active: true, createdAt: '', updatedAt: '' });
new AccessRepository().users.create({ id: 'nau_3', numberId: number.id, userId: amit.id, sequenceOrder: 3, active: true, createdAt: '', updatedAt: '' });
// Amit is on the participant list but not marked assignment-eligible — must be skipped.
phase1().setAssignmentEligibility({ userId: rahul.id, numberId: number.id, teamId: team.id, eligible: true });
phase1().setAssignmentEligibility({ userId: priya.id, numberId: number.id, teamId: team.id, eligible: true });

const config = new AccessRepository().config.create({ id: 'config_1', numberId: number.id, roundRobinEnabled: true, fallbackUserId: '', workingHoursStart: '', workingHoursEnd: '', lastAssignedUserId: '', createdAt: '', updatedAt: '' });

// Round robin rotates across eligible agents only (Amit skipped — not assignment-eligible), and wraps around.
const customer1 = new CustomerRepository().create({ id: 'customer_1', phone: '+919000000001', name: '', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
const customer2 = new CustomerRepository().create({ id: 'customer_2', phone: '+919000000002', name: '', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
const customer3 = new CustomerRepository().create({ id: 'customer_3', phone: '+919000000003', name: '', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });

const conv1 = newConversation(customer1.id, number.id);
phase7().assignConversation(conv1, true);
assert.strictEqual(new ConversationRepository().get(conv1.id).assignedUserId, rahul.id);

const conv2 = newConversation(customer2.id, number.id);
phase7().assignConversation(conv2, true);
assert.strictEqual(new ConversationRepository().get(conv2.id).assignedUserId, priya.id);

const conv3 = newConversation(customer3.id, number.id);
phase7().assignConversation(conv3, true);
assert.strictEqual(new ConversationRepository().get(conv3.id).assignedUserId, rahul.id, 'wraps back to Rahul, skipping ineligible Amit');

// Assignment history recorded with the right reason.
const history = phase7().listAssignmentHistory(conv1.id);
assert.strictEqual(history.length, 1);
assert.strictEqual(history[0].reason, 'round_robin');
assert.strictEqual(history[0].userId, rahul.id);

// A returning customer's new conversation inherits their prior owner — no round-robin advance.
const conv1b = newConversation(customer1.id, number.id);
phase7().assignConversation(conv1b, false);
assert.strictEqual(new ConversationRepository().get(conv1b.id).assignedUserId, rahul.id);
assert.strictEqual(phase7().listAssignmentHistory(conv1b.id)[0].reason, 'returning_customer');

// Nobody available (all offline) + no fallback → stays unassigned.
[rahul, priya].forEach(user => phase1().setUserAvailability(user.id, 'offline'));
const customer4 = new CustomerRepository().create({ id: 'customer_4', phone: '+919000000004', name: '', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
const conv4 = newConversation(customer4.id, number.id);
const result4 = phase7().assignConversation(conv4, true);
assert.strictEqual(result4, null);
assert.strictEqual(new ConversationRepository().get(conv4.id).assignedUserId, '');

// A configured fallback catches the "nobody eligible" case instead of leaving it unassigned.
new AccessRepository().config.update(config.id, { fallbackUserId: priya.id });
const customer5 = new CustomerRepository().create({ id: 'customer_5', phone: '+919000000005', name: '', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
const conv5 = newConversation(customer5.id, number.id);
phase7().assignConversation(conv5, true);
assert.strictEqual(new ConversationRepository().get(conv5.id).assignedUserId, priya.id);
assert.strictEqual(phase7().listAssignmentHistory(conv5.id)[0].reason, 'fallback');
new AccessRepository().config.update(config.id, { fallbackUserId: '' });
[rahul, priya].forEach(user => phase1().setUserAvailability(user.id, 'available'));

// Outside configured working hours falls back to unassigned even with eligible agents.
new AccessRepository().config.update(config.id, { workingHoursStart: '09:00', workingHoursEnd: '18:00' });
fakeTime = '23:00';
const customer6 = new CustomerRepository().create({ id: 'customer_6', phone: '+919000000006', name: '', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
const conv6 = newConversation(customer6.id, number.id);
assert.strictEqual(phase7().assignConversation(conv6, true), null);
fakeTime = '12:00';
new AccessRepository().config.update(config.id, { workingHoursStart: '', workingHoursEnd: '' });

// Manual reassignment: ADMIN can; a non-assigned AGENT cannot.
email = 'admin@example.com';
const reassigned = phase7().reassignConversation(conv1.id, priya.id);
assert.strictEqual(reassigned.assignedUserId, priya.id);
assert.strictEqual(phase7().listAssignmentHistory(conv1.id).pop().reason, 'manual');

email = 'rahul@example.com';
assert.throws(() => phase7().reassignConversation(conv1.id, rahul.id), error => error.code === 'FORBIDDEN');

console.log('Phase 7 assignment verification: PASS');

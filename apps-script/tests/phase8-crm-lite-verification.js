/* Run with: node tests/phase8-crm-lite-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = { SPREADSHEET_ID: 'mock-spreadsheet-id', 'wap.phase1.bootstrapAdminEmail': 'admin@example.com' };
let email = 'admin@example.com';
global.Utilities = { getUuid: (() => { let n = 0; return () => String(++n); })(), formatDate: () => '12:00' };
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
const phase8 = () => new Phase8Api();
const forbidden = fn => assert.throws(fn, error => error && error.code === 'FORBIDDEN');

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;
const agent = phase1().createUser({ email: 'agent@example.com', displayName: 'Agent', roleIds: [roleId('AGENT')] });
const supervisor = phase1().createUser({ email: 'supervisor@example.com', displayName: 'Supervisor', roleIds: [roleId('SUPERVISOR')] });
const viewer = phase1().createUser({ email: 'viewer@example.com', displayName: 'Viewer', roleIds: [roleId('VIEWER')] });

const number = new NumberRepository().create({ id: 'number_1', displayName: 'Sales 1', phoneNumber: '079-1', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '', updatedAt: '' });
const customer = new CustomerRepository().create({ id: 'customer_1', phone: '+919999999999', name: 'Test Customer', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
const otherCustomer = new CustomerRepository().create({ id: 'customer_2', phone: '+919999999998', name: 'Other Customer', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
const conversation = new ConversationRepository().create({ id: 'conversation_1', customerId: customer.id, numberId: number.id, assignedUserId: agent.id, status: 'OPEN', needsResponse: true, lastMessageAt: '', createdAt: '', updatedAt: '' });

phase1().grantNumberAccess({ userId: agent.id, numberId: number.id });
phase1().grantNumberAccess({ userId: supervisor.id, numberId: number.id });
phase1().grantNumberAccess({ userId: viewer.id, numberId: number.id });
// Supervisor needs an actual team relationship to the number — resolveTeamIdForNumber
// (and therefore requireConversationOperation's team-view path) needs it, a plain
// numberAccess grant alone isn't enough for SUPERVISOR/SITE_MANAGER (see Phase 5/7 notes).
const siteManager = phase1().createUser({ email: 'sitemanager@example.com', displayName: 'Site Manager', roleIds: [roleId('SITE_MANAGER')] });
const team = phase1().createTeam({ name: 'Team 1', ownerUserId: siteManager.id });
phase1().addTeamMember({ teamId: team.id, userId: supervisor.id, numberIds: [number.id] });

// Seeding default stages: ADMIN only, and only once.
forbidden(() => { email = 'agent@example.com'; phase8().seedDefaultLeadStages(); });
email = 'admin@example.com';
const seeded = phase8().seedDefaultLeadStages();
assert.strictEqual(seeded.length, 7);
assert.strictEqual(seeded[0].key, 'new');
assert.throws(() => phase8().seedDefaultLeadStages(), error => error.code === 'CONFLICT');

// Any authenticated user can list stages (needed for the UI dropdown).
email = 'viewer@example.com';
assert.strictEqual(phase8().listStages().length, 7);

// Only ADMIN can create/update stage definitions.
email = 'admin@example.com';
const customStage = phase8().createStage({ key: 'demo_booked', name: 'Demo Booked', sequenceOrder: 8 });
forbidden(() => { email = 'agent@example.com'; phase8().createStage({ key: 'x', name: 'X' }); });
email = 'admin@example.com';
phase8().updateStage(customStage.id, { name: 'Demo Scheduled' });

// AGENT can set the stage of a customer they have a related (viewable) conversation with.
email = 'agent@example.com';
const won = seeded.find(s => s.key === 'won');
const stageRecord = phase8().setCustomerStage(customer.id, won.id);
assert.strictEqual(stageRecord.stageId, won.id);
assert.strictEqual(phase8().getCustomerStage(customer.id).stageId, won.id);

// AGENT cannot set the stage of a customer with no related conversation.
forbidden(() => phase8().setCustomerStage(otherCustomer.id, won.id));

// Regression: getCustomerStage used to have NO authorization check at all (any signed-in
// account, even one with no Users record, could read any customer's stage). AGENT with
// no relationship to otherCustomer must now be denied, same as the write path above.
forbidden(() => phase8().getCustomerStage(otherCustomer.id));

// ADMIN can set any customer's stage regardless of relationship.
email = 'admin@example.com';
assert.doesNotThrow(() => phase8().setCustomerStage(otherCustomer.id, won.id));
// ADMIN can also read any customer's stage regardless of relationship.
assert.strictEqual(phase8().getCustomerStage(otherCustomer.id).stageId, won.id);

// Remarks: AGENT (assigned) can add; SUPERVISOR (view-only permission) cannot add but can list; VIEWER can neither add nor list.
email = 'agent@example.com';
const remark = phase8().addRemark(conversation.id, 'Called the customer, following up tomorrow.');
assert.strictEqual(remark.authorUserId, agent.id);

email = 'supervisor@example.com';
forbidden(() => phase8().addRemark(conversation.id, 'Trying to add one'));
const remarksForSupervisor = phase8().listRemarks(conversation.id);
assert.strictEqual(remarksForSupervisor.length, 1);

email = 'viewer@example.com';
forbidden(() => phase8().addRemark(conversation.id, 'Trying to add one'));
forbidden(() => phase8().listRemarks(conversation.id));

// Customer directory (2026-08-10): ADMIN sees every customer; AGENT sees only customers they have a related conversation with.
email = 'agent@example.com';
const agentCustomers = phase8().listCustomers();
assert.strictEqual(agentCustomers.length, 1);
assert.strictEqual(agentCustomers[0].id, customer.id, 'agent has a conversation with customer but not otherCustomer at this point in the test');

email = 'admin@example.com';
assert.strictEqual(phase8().listCustomers().length, 2);

// numberId (2026-08-10, user-directed): scopes the directory to customers with at
// least one conversation on that number, so switching numbers in the UI doesn't blend
// customers from unrelated brands/numbers together.
const otherNumber = new NumberRepository().create({ id: 'number_2', displayName: 'Sales 2', phoneNumber: '079-2', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '', updatedAt: '' });
new ConversationRepository().create({ id: 'conversation_2', customerId: otherCustomer.id, numberId: otherNumber.id, assignedUserId: '', status: 'OPEN', needsResponse: false, lastMessageAt: '', createdAt: '', updatedAt: '' });
assert.strictEqual(phase8().listCustomers(number.id).length, 1);
assert.strictEqual(phase8().listCustomers(number.id)[0].id, customer.id);
assert.strictEqual(phase8().listCustomers(otherNumber.id).length, 1);
assert.strictEqual(phase8().listCustomers(otherNumber.id)[0].id, otherCustomer.id);

// updateCustomer: same relationship gate, phone is not an editable field (it's the ingestion match key).
email = 'agent@example.com';
const updated = phase8().updateCustomer(customer.id, { name: 'Test Customer Updated', company: 'Acme' });
assert.strictEqual(updated.name, 'Test Customer Updated');
assert.strictEqual(updated.company, 'Acme');
assert.throws(() => phase8().updateCustomer(customer.id, { phone: '+910000000000' }), error => error.code === 'VALIDATION_ERROR');
forbidden(() => phase8().updateCustomer(otherCustomer.id, { name: 'Should not work' }));
email = 'admin@example.com';
assert.doesNotThrow(() => phase8().updateCustomer(otherCustomer.id, { name: 'Admin can edit anyone' }));

console.log('Phase 8 CRM-lite verification: PASS');

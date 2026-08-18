/* Run with: node tests/phase13-search-notifications-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = { SPREADSHEET_ID: 'mock-spreadsheet-id', 'wap.phase1.bootstrapAdminEmail': 'admin@example.com' };
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
const phase13 = () => new Phase13Api();

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;

const agent = phase1().createUser({ email: 'agent@example.com', displayName: 'Agent', roleIds: [roleId('AGENT')] });
const otherAgent = phase1().createUser({ email: 'other-agent@example.com', displayName: 'Other Agent', roleIds: [roleId('AGENT')] });

const numberA = new NumberRepository().create({ id: 'number_a', displayName: 'Sales 1', phoneNumber: '079-1', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '', updatedAt: '' });
const numberB = new NumberRepository().create({ id: 'number_b', displayName: 'Sales 2', phoneNumber: '079-2', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '', updatedAt: '' });
phase1().grantNumberAccess({ userId: agent.id, numberId: numberA.id });
phase1().grantNumberAccess({ userId: agent.id, numberId: numberB.id });

const rahulCustomer = new CustomerRepository().create({ id: 'customer_rahul', phone: '+919000000001', name: 'Rahul Sharma', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
const priyaCustomer = new CustomerRepository().create({ id: 'customer_priya', phone: '+919000000002', name: 'Priya Verma', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });

// conv1/conv3 are assigned to the agent (so the agent can see them too, later);
// conv2 is unassigned — only ADMIN (or a team-scoped supervisor) can see an
// unassigned conversation, per Phase 1's authorization model, so the general
// search/filter demonstrations below run as ADMIN.
const conv1 = new ConversationRepository().create({ id: 'conversation_1', customerId: rahulCustomer.id, numberId: numberA.id, assignedUserId: agent.id, status: 'OPEN', needsResponse: true, lastMessageAt: '2026-08-01T00:00:00.000Z', createdAt: '', updatedAt: '' });
const conv2 = new ConversationRepository().create({ id: 'conversation_2', customerId: priyaCustomer.id, numberId: numberA.id, assignedUserId: '', status: 'OPEN', needsResponse: false, lastMessageAt: '2026-08-05T00:00:00.000Z', createdAt: '', updatedAt: '' });
const conv3 = new ConversationRepository().create({ id: 'conversation_3', customerId: rahulCustomer.id, numberId: numberB.id, assignedUserId: agent.id, status: 'OPEN', needsResponse: true, lastMessageAt: '2026-08-03T00:00:00.000Z', createdAt: '', updatedAt: '' });
new MessageRepository().create({ id: 'message_1', conversationId: conv2.id, numberId: numberA.id, senderUserId: '', direction: 'INBOUND', messageType: 'text', messageText: 'Do you have a quotation for GST filing?', providerMessageId: 'wamid.1', status: 'RECEIVED', timestamp: '2026-08-05T00:00:00.000Z' });

email = 'admin@example.com';

// Search by customer name, scoped to a single number.
const byName = phase13().searchConversations({ numberId: numberA.id, query: 'rahul' });
assert.strictEqual(byName.length, 1);
assert.strictEqual(byName[0].id, conv1.id);
assert.strictEqual(byName[0].customerName, 'Rahul Sharma');
assert.strictEqual(byName[0].numberDisplayName, 'Sales 1');

// Search by message text content.
const byMessage = phase13().searchConversations({ numberId: numberA.id, query: 'quotation' });
assert.strictEqual(byMessage.length, 1);
assert.strictEqual(byMessage[0].id, conv2.id);

// Search by phone digits.
const byPhone = phase13().searchConversations({ numberId: numberA.id, query: '9000000002' });
assert.strictEqual(byPhone.length, 1);
assert.strictEqual(byPhone[0].id, conv2.id);

// No numberId given → searches across every number the signed-in user can access.
const acrossNumbers = phase13().searchConversations({ query: 'rahul' });
assert.strictEqual(acrossNumbers.length, 2, 'Rahul has one conversation on each of the two registered numbers');

// Filters: needsResponse, unassigned, status, assignedUserId.
assert.strictEqual(phase13().searchConversations({ numberId: numberA.id, needsResponse: true }).length, 1);
assert.strictEqual(phase13().searchConversations({ numberId: numberA.id, unassigned: true }).length, 1);
assert.strictEqual(phase13().searchConversations({ numberId: numberA.id, unassigned: true })[0].id, conv2.id);
assert.strictEqual(phase13().searchConversations({ numberId: numberA.id, assignedUserId: agent.id }).length, 1);
assert.strictEqual(phase13().searchConversations({ numberId: numberA.id, status: 'OPEN' }).length, 2);

// Resolved (CLOSED) conversations are excluded by default, but still findable when
// explicitly requested by status — matches listConversations()'s own default and
// Phase 6's resolveConversation (src/Phase6Services.gs).
new ConversationRepository().update(conv2.id, { status: 'CLOSED' });
assert.strictEqual(phase13().searchConversations({ numberId: numberA.id }).length, 1, 'default search excludes the resolved conversation');
assert.strictEqual(phase13().searchConversations({ numberId: numberA.id, status: 'CLOSED' }).length, 1);
assert.strictEqual(phase13().searchConversations({ numberId: numberA.id, status: 'CLOSED' })[0].id, conv2.id);
new ConversationRepository().update(conv2.id, { status: 'OPEN' });

// Date range filter.
assert.strictEqual(phase13().searchConversations({ numberId: numberA.id, dateFrom: '2026-08-03T00:00:00.000Z' }).length, 1);
assert.strictEqual(phase13().searchConversations({ numberId: numberA.id, dateTo: '2026-08-02T00:00:00.000Z' }).length, 1);

// customerId filter + status: 'ANY' (Customer Details "Previous Conversations" — full
// history including resolved, not just the active inbox).
assert.strictEqual(phase13().searchConversations({ customerId: rahulCustomer.id }).length, 2, 'rahul has one conversation on each number');
new ConversationRepository().update(conv1.id, { status: 'CLOSED' });
assert.strictEqual(phase13().searchConversations({ customerId: rahulCustomer.id }).length, 1, 'default still excludes the now-closed one');
assert.strictEqual(phase13().searchConversations({ customerId: rahulCustomer.id, status: 'ANY' }).length, 2, 'status: ANY includes it');
new ConversationRepository().update(conv1.id, { status: 'OPEN' });

// Stage filter.
phase8().seedDefaultLeadStages();
const contactedStage = phase8().listStages().find(s => s.key === 'contacted');
phase8().setCustomerStage(priyaCustomer.id, contactedStage.id);
const byStage = phase13().searchConversations({ numberId: numberA.id, stageId: contactedStage.id });
assert.strictEqual(byStage.length, 1);
assert.strictEqual(byStage[0].id, conv2.id);

// Search results still respect Phase 5's own authorization — an agent with number
// access but no relationship to a specific conversation never sees it, even via search.
email = 'admin@example.com';
phase1().grantNumberAccess({ userId: otherAgent.id, numberId: numberA.id });
email = 'other-agent@example.com';
assert.strictEqual(phase13().searchConversations({ numberId: numberA.id, query: 'rahul' }).length, 0);

// An agent legitimately assigned to conversations does find them via search.
email = 'agent@example.com';
assert.strictEqual(phase13().searchConversations({ numberId: numberA.id, query: 'rahul' }).length, 1);
assert.strictEqual(phase13().searchConversations({ numberId: numberA.id, query: 'quotation' }).length, 0, 'the agent is not assigned to the unassigned conversation, so cannot find it even by message text');

// Needs-response counts, per number, scoped to what the signed-in user can access.
const counts = phase13().getNeedsResponseCounts();
assert.strictEqual(counts[numberA.id], 1);
assert.strictEqual(counts[numberB.id], 1);

console.log('Phase 13 search & notifications verification: PASS');

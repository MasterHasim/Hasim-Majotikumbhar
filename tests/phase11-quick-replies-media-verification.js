/* Run with: node tests/phase11-quick-replies-media-verification.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = {
  SPREADSHEET_ID: 'mock-spreadsheet-id', 'wap.phase1.bootstrapAdminEmail': 'admin@example.com',
  EXOTEL_API_KEY: 'key', EXOTEL_API_TOKEN: 'token', EXOTEL_ACCOUNT_SID: 'sid', EXOTEL_SUBDOMAIN: 'api.exotel.com'
};
let email = 'admin@example.com';
global.Utilities = { getUuid: (() => { let n = 0; return () => String(++n); })(), base64Encode: str => Buffer.from(str, 'utf8').toString('base64') };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) };
global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
global.Session = { getActiveUser: () => ({ getEmail: () => email }) };

let nextFetchBehavior = null;
let lastFetchRequest = null;
global.UrlFetchApp = {
  fetch: (url, options) => {
    lastFetchRequest = { url, options, body: options.payload ? JSON.parse(options.payload) : null };
    const behavior = nextFetchBehavior();
    return { getResponseCode: () => behavior.code, getContentText: () => JSON.stringify(behavior.body) };
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

const phase1 = () => new Phase1Api();
const phase4 = () => new Phase4Api();
const phase6 = () => new Phase6Api();
const phase11 = () => new Phase11Api();
const forbidden = fn => assert.throws(fn, error => error && error.code === 'FORBIDDEN');

phase1().bootstrap({ email, displayName: 'Admin' });
const roles = phase1().listRoles();
const roleId = key => roles.find(role => role.key === key).id;
const agent = phase1().createUser({ email: 'agent@example.com', displayName: 'Agent', roleIds: [roleId('AGENT')] });

// --- Quick replies: ADMIN-only create/update, list is available to any authenticated user. ---
forbidden(() => { email = 'agent@example.com'; phase11().createQuickReply({ shortcut: '/thanks', text: 'Thank you!' }); });
email = 'admin@example.com';
const qr = phase11().createQuickReply({ shortcut: '/thanks', text: 'Thank you for reaching out!' });
assert.strictEqual(qr.shortcut, '/thanks');
assert.throws(() => phase11().createQuickReply({ shortcut: '/thanks', text: 'dup' }), error => error.code === 'CONFLICT');

const updated = phase11().updateQuickReply(qr.id, { text: 'Thanks so much for reaching out!' });
assert.strictEqual(updated.text, 'Thanks so much for reaching out!');
forbidden(() => { email = 'agent@example.com'; phase11().updateQuickReply(qr.id, { text: 'nope' }); });

email = 'agent@example.com';
const list = phase11().listQuickReplies();
assert.strictEqual(list.length, 1);
assert.strictEqual(list[0].shortcut, '/thanks');
email = 'admin@example.com';

// An inactive quick reply is excluded from the list.
phase11().createQuickReply({ shortcut: '/bye', text: 'Goodbye', active: false });
assert.strictEqual(phase11().listQuickReplies().length, 1);

// --- Phase 6: sendMediaReply — authorization, request construction, Message_Media record. ---
const number = new NumberRepository().create({ id: 'number_1', displayName: 'Sales 1', phoneNumber: '079-485-02801', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '', updatedAt: '' });
const customer = new CustomerRepository().create({ id: 'customer_1', phone: '+919999999999', name: '', email: '', company: '', source: 'whatsapp', createdAt: '', updatedAt: '' });
const conversation = new ConversationRepository().create({ id: 'conversation_1', customerId: customer.id, numberId: number.id, assignedUserId: agent.id, status: 'OPEN', needsResponse: true, lastMessageAt: '', createdAt: '', updatedAt: '' });
phase1().grantNumberAccess({ userId: agent.id, numberId: number.id });

// A non-assigned agent cannot send media on this conversation.
const otherAgent = phase1().createUser({ email: 'other-agent@example.com', displayName: 'Other Agent', roleIds: [roleId('AGENT')] });
phase1().grantNumberAccess({ userId: otherAgent.id, numberId: number.id });
forbidden(() => { email = 'other-agent@example.com'; phase6().sendMediaReply(conversation.id, 'image', 'https://example.com/photo.jpg', 'A photo'); });

email = 'agent@example.com';
nextFetchBehavior = () => ({ code: 200, body: { sid: 'wamid.media.1' } });
const mediaMessage = phase6().sendMediaReply(conversation.id, 'image', 'https://example.com/photo.jpg', 'A photo');
assert.strictEqual(mediaMessage.status, 'SENT');
assert.strictEqual(mediaMessage.messageType, 'media');
assert.strictEqual(mediaMessage.messageText, 'A photo');
assert.strictEqual(lastFetchRequest.body.whatsapp.messages[0].content.type, 'image');
assert.strictEqual(lastFetchRequest.body.whatsapp.messages[0].content.image.link, 'https://example.com/photo.jpg');
assert.strictEqual(lastFetchRequest.body.whatsapp.messages[0].content.image.caption, 'A photo');

const outboundMedia = new MessageMediaRepository().list().find(m => m.messageId === mediaMessage.id);
assert.ok(outboundMedia, 'a Message_Media record should be created for the outbound send');
assert.strictEqual(outboundMedia.mediaType, 'image');
assert.strictEqual(outboundMedia.mediaUrl, 'https://example.com/photo.jpg');

// A failed send still records the message (status FAILED) but the response is unusable, so no Message_Media confusion — the record is still written since the attempt did carry real media intent.
nextFetchBehavior = () => ({ code: 500, body: { error: 'boom' } });
const failedMedia = phase6().sendMediaReply(conversation.id, 'document', 'https://example.com/file.pdf', '');
assert.strictEqual(failedMedia.status, 'FAILED');
assert.strictEqual(failedMedia.messageText, '[Media: document]');

// --- Phase 4: inbound media ingestion writes a Message_Media record when mediaUrl is present. ---
const inboundImagePayload = {
  whatsapp: {
    messages: [{
      callback_type: 'incoming_message', sid: 'wamid.inbound.media.1', from: '+919999999999', to: '+917948502801',
      timestamp: '2026-08-10T00:00:00.000Z', profile_name: 'Eva',
      content: { type: 'image', image: { link: 'https://exotel.example.com/inbound-photo.jpg', caption: 'Check this out' } }
    }]
  }
};
const normalized = new ExotelProvider().processWebhook(inboundImagePayload);
assert.strictEqual(normalized.mediaUrl, 'https://exotel.example.com/inbound-photo.jpg');

const ingested = phase4().ingestInboundMessage(normalized);
assert.strictEqual(ingested.duplicate, false);
const inboundMedia = new MessageMediaRepository().list().find(m => m.messageId === ingested.messageId);
assert.ok(inboundMedia, 'a Message_Media record should be created for an inbound message with a mediaUrl');
assert.strictEqual(inboundMedia.mediaType, 'image');
assert.strictEqual(inboundMedia.mediaUrl, 'https://exotel.example.com/inbound-photo.jpg');

// A plain text inbound message (no mediaUrl) creates no Message_Media record.
const textNormalized = new ExotelProvider().processWebhook({ whatsapp: { messages: [{ sid: 'wamid.inbound.text.1', from: '+919999999999', to: '+917948502801', timestamp: '2026-08-10T00:01:00.000Z', content: { type: 'text', text: { body: 'Hello' } } }] } });
assert.strictEqual(textNormalized.mediaUrl, null);
const ingestedText = phase4().ingestInboundMessage(textNormalized);
assert.strictEqual(new MessageMediaRepository().list().find(m => m.messageId === ingestedText.messageId), undefined);

console.log('Phase 11 quick replies & media verification: PASS');

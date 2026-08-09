/* Run with: node tests/phase3-provider-verification.js
 * Verifies ExotelProvider builds requests correctly against OUR OWN best-effort
 * assumptions (see src/Phase3ExotelProvider.gs) — it cannot prove Exotel's real API
 * accepts this shape, since that requires live credentials. Live verification happens
 * separately once EXOTEL_* Script Properties are set (see PROGRESS.md). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const properties = {
  EXOTEL_API_KEY: 'key123', EXOTEL_API_TOKEN: 'token456',
  EXOTEL_ACCOUNT_SID: 'sid789', EXOTEL_SUBDOMAIN: 'api.exotel.com'
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) };
global.Utilities = { base64Encode: str => Buffer.from(str, 'utf8').toString('base64'), getUuid: (() => { let n = 0; return () => String(++n); })() };

let lastRequest = null;
let nextResponse = { code: 200, body: { message_sid: 'msg_1' } };
global.UrlFetchApp = {
  fetch: (url, options) => {
    lastRequest = { url, options, body: options.payload ? JSON.parse(options.payload) : null };
    return { getResponseCode: () => nextResponse.code, getContentText: () => JSON.stringify(nextResponse.body) };
  }
};

const srcDir = path.join(__dirname, '..', 'src');
fs.readdirSync(srcDir).filter(file => file.endsWith('.gs')).sort().forEach(file => {
  vm.runInThisContext(fs.readFileSync(path.join(srcDir, file), 'utf8'), { filename: file });
});

function expectedAuthHeader() { return 'Basic ' + Buffer.from('key123:token456', 'utf8').toString('base64'); }

// sendText: URL, auth header, and body shape.
const provider = new ExotelProvider();
provider.sendText('provider-number-1', '+919999999999', 'Hello');
assert.strictEqual(lastRequest.url, 'https://api.exotel.com/v2/accounts/sid789/messages');
assert.strictEqual(lastRequest.options.method, 'POST');
assert.strictEqual(lastRequest.options.headers.Authorization, expectedAuthHeader());
assert.deepStrictEqual(lastRequest.body, { whatsapp: { messages: [{ from: 'provider-number-1', to: '+919999999999', content: { type: 'text', text: { body: 'Hello' } } }] } });

// sendMedia and sendTemplate build the expected content shape.
provider.sendMedia('provider-number-1', '+919999999999', 'image', 'https://example.com/x.png', 'caption');
assert.deepStrictEqual(lastRequest.body.whatsapp.messages[0].content, { type: 'image', image: { link: 'https://example.com/x.png', caption: 'caption' } });

provider.sendTemplate('provider-number-1', '+919999999999', 'order_update', 'en', [{ type: 'body', parameters: [] }]);
assert.deepStrictEqual(lastRequest.body.whatsapp.messages[0].content, { type: 'template', template: { name: 'order_update', language: { code: 'en' }, components: [{ type: 'body', parameters: [] }] } });

// getTemplates omits the query string entirely when no wabaId is given.
provider.getTemplates();
assert.strictEqual(lastRequest.url, 'https://api.exotel.com/v2/accounts/sid789/templates');

// getTemplates / createTemplate build the expected GET/POST paths.
provider.getTemplates('waba-1');
assert.strictEqual(lastRequest.url, 'https://api.exotel.com/v2/accounts/sid789/templates?waba_id=waba-1');
assert.strictEqual(lastRequest.options.method, 'GET');

provider.createTemplate('waba-1', { name: 'order_update', language: 'en' });
assert.strictEqual(lastRequest.url, 'https://api.exotel.com/v2/accounts/sid789/templates');
assert.deepStrictEqual(lastRequest.body, { waba_id: 'waba-1', name: 'order_update', language: 'en' });

// getMessageStatus maps the confirmed status codes.
nextResponse = { code: 200, body: { status_code: 30002 } };
const status = provider.getMessageStatus('msg_1');
assert.strictEqual(status.status, 'DELIVERED');

// Non-2xx response throws PROVIDER_ERROR.
nextResponse = { code: 500, body: { error: 'boom' } };
assert.throws(() => provider.getMessageStatus('msg_1'), error => error.code === 'PROVIDER_ERROR');

// Missing Script Property throws CONFIGURATION_ERROR before any request is made.
delete properties.EXOTEL_API_KEY;
assert.throws(() => new ExotelProvider(), error => error.code === 'CONFIGURATION_ERROR');
properties.EXOTEL_API_KEY = 'key123';

// processWebhook normalizes both an inbound-message payload and a status-callback payload.
const inboundNormalized = provider.processWebhook({ whatsapp: { messages: [{ id: 'wamid.1', from: '+919999999999', to: 'provider-number-1', content: { type: 'text', text: { body: 'Hi' } }, timestamp: '2026-08-09T00:00:00.000Z' }] } });
assert.strictEqual(inboundNormalized.providerMessageId, 'wamid.1');
assert.strictEqual(inboundNormalized.direction, 'INBOUND');
assert.strictEqual(inboundNormalized.text, 'Hi');

const statusNormalized = provider.processWebhook({ message_sid: 'msg_1', status_code: 30003 });
assert.strictEqual(statusNormalized.status, 'READ');

console.log('Phase 3 ExotelProvider verification: PASS');

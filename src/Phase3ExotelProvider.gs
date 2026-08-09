/**
 * ExotelProvider: the first WhatsAppProvider implementation (Phase3ProviderContract
 * in src/Phase3Domain.gs). Confirmed against public Exotel docs: base URL pattern
 * `https://<subdomain>/v2/accounts/<account_sid>/messages` and HTTP Basic Auth with
 * API key/token (https://developer.exotel.com/docs/whatsapp-api/overview).
 *
 * Exotel's detailed API reference pages could not be fetched (404, likely
 * JS-rendered), so most of this was originally a best-effort guess modeled on
 * WhatsApp Cloud API conventions (Exotel's product sits on top of WABA). Fields still
 * marked UNVERIFIED below have not been live-tested — do not trust them until they
 * are. getTemplates() IS live-confirmed (2026-08-09, real account, real templates
 * returned) — see memory/DECISIONS.md for exactly what's confirmed vs. assumed.
 * sendText/sendMedia/sendTemplate/createTemplate/getMessageStatus remain unverified:
 * verifying those means actually sending a real message or creating a real template
 * (real cost/effect), so that's deferred to Phase 6 rather than done speculatively now.
 *
 * Status code mapping is confirmed from public docs: 30001 Sent, 30002 Delivered,
 * 30003 Seen; 30004-30041 are various failure codes.
 */
var Phase3ExotelStatusCodes = { 30001: 'SENT', 30002: 'DELIVERED', 30003: 'READ' };

class ExotelProvider {
  constructor() {
    this.config_ = Phase3ExotelConfig.require_();
  }

  sendText(providerNumberId, toPhone, text) {
    return this.sendMessages_([{
      from: providerNumberId, to: toPhone,
      content: { type: 'text', text: { body: text } } // UNVERIFIED shape
    }]);
  }

  sendMedia(providerNumberId, toPhone, mediaType, mediaUrl, caption) {
    var content = { type: mediaType }; // UNVERIFIED shape
    content[mediaType] = { link: mediaUrl, caption: caption || '' };
    return this.sendMessages_([{ from: providerNumberId, to: toPhone, content: content }]);
  }

  sendTemplate(providerNumberId, toPhone, templateName, language, components) {
    return this.sendMessages_([{
      from: providerNumberId, to: toPhone,
      content: { type: 'template', template: { name: templateName, language: { code: language }, components: components || [] } } // UNVERIFIED shape
    }]);
  }

  sendMessages_(messages) {
    return this.request_('POST', 'messages', { whatsapp: { messages: messages } }); // UNVERIFIED envelope
  }

  getTemplates(wabaId) {
    // Confirmed live 2026-08-09: GET /v2/accounts/<sid>/templates?waba_id=<waba_id> (not /whatsapp/templates).
    // Confirmed response shape: {request_id, method, http_code, response: {whatsapp: {templates: [{code, error_data, status, data: {waba_id, name, components, language, status, category, id, ...}}], paging: {cursors: {after, before}}}}}.
    var path = 'templates' + (wabaId ? '?waba_id=' + encodeURIComponent(wabaId) : '');
    return this.request_('GET', path);
  }

  createTemplate(wabaId, definition) {
    var body = Object.assign({ waba_id: wabaId }, definition); // UNVERIFIED shape (path fixed 2026-08-09, body still assumed)
    return this.request_('POST', 'templates', body);
  }

  getMessageStatus(providerMessageId) {
    var response = this.request_('GET', 'messages/' + encodeURIComponent(providerMessageId)); // UNVERIFIED path
    var code = response && response.status_code;
    return { providerMessageId: providerMessageId, status: Phase3ExotelStatusCodes[code] || 'UNKNOWN', raw: response };
  }

  processWebhook(payload) {
    // UNVERIFIED — best-effort normalization; refine once a real webhook payload is captured (Phase 4).
    var message = payload && payload.whatsapp && payload.whatsapp.messages && payload.whatsapp.messages[0];
    if (message) {
      return {
        providerMessageId: message.id || message.message_sid || null,
        fromPhone: message.from || null,
        providerNumberId: message.to || null,
        direction: 'INBOUND',
        messageType: (message.content && message.content.type) || 'text',
        text: message.content && message.content.text && message.content.text.body,
        timestamp: message.timestamp || Phase1Ids.now(),
        status: null
      };
    }
    if (payload && (payload.message_sid || payload.status_code)) {
      return {
        providerMessageId: payload.message_sid || null, fromPhone: null, providerNumberId: null,
        direction: null, messageType: null, text: null,
        timestamp: payload.timestamp || Phase1Ids.now(),
        status: Phase3ExotelStatusCodes[payload.status_code] || 'UNKNOWN'
      };
    }
    return { providerMessageId: null, fromPhone: null, providerNumberId: null, direction: null, messageType: null, text: null, timestamp: Phase1Ids.now(), status: null, raw: payload };
  }

  request_(method, path, body) {
    var url = 'https://' + this.config_.subdomain + '/v2/accounts/' + encodeURIComponent(this.config_.accountSid) + '/' + path;
    var options = {
      method: method,
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(this.config_.apiKey + ':' + this.config_.apiToken) },
      muteHttpExceptions: true
    };
    if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
    var response = UrlFetchApp.fetch(url, options);
    var status = response.getResponseCode();
    var parsed = null;
    try { parsed = JSON.parse(response.getContentText()); } catch (e) { parsed = response.getContentText(); }
    if (status < 200 || status >= 300) throw new Phase1Error('PROVIDER_ERROR', 'Exotel request failed (' + status + '): ' + JSON.stringify(parsed));
    return parsed;
  }
}

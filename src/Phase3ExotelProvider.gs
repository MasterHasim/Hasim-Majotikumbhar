/**
 * ExotelProvider: the first WhatsAppProvider implementation (Phase3ProviderContract
 * in src/Phase3Domain.gs). Confirmed against public Exotel docs: base URL pattern
 * `https://<subdomain>/v2/accounts/<account_sid>/messages` and HTTP Basic Auth with
 * API key/token (https://developer.exotel.com/docs/whatsapp-api/overview).
 *
 * UNVERIFIED — Exotel's detailed API reference pages could not be fetched (404,
 * likely JS-rendered), so every request/response field name below is a best-effort
 * guess modeled on WhatsApp Cloud API conventions (Exotel's product sits on top of
 * WABA). Each guessed shape is flagged inline. Do not trust these field names until
 * live-verified against a real account (see memory/DECISIONS.md, Phase 3 entry) —
 * the same live-verification step that caught two real bugs in Phase 2.
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
    return this.request_('GET', 'whatsapp/templates?waba_id=' + encodeURIComponent(wabaId)); // UNVERIFIED path
  }

  createTemplate(wabaId, definition) {
    var body = Object.assign({ waba_id: wabaId }, definition); // UNVERIFIED shape
    return this.request_('POST', 'whatsapp/templates', body);
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

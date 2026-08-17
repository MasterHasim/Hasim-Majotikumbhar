/**
 * ExotelVoiceProvider: click-to-call for Phase 22 leads. Deliberately separate from
 * Phase3ExotelProvider.gs (WhatsApp) — Exotel's Voice API is a different product on a
 * fixed `api.exotel.com` domain (not the WABA `v2` subdomain Phase 3 uses), so it gets
 * its own Script Properties rather than assuming the same account/subdomain covers
 * both. If this Exotel account's Voice and WhatsApp credentials are actually the same,
 * just set both sets of properties to the same values — nothing here requires them to
 * differ.
 *
 * UNVERIFIED: modeled on Exotel's public "Connect two numbers" / click-to-call docs
 * (POST /v1/Accounts/{sid}/Calls/connect.json, From/To/CallerId form params, Basic
 * Auth with API Key:Token) but not yet exercised against a real account — same
 * "confirmed vs. assumed" caveat Phase3ExotelProvider.gs carries for its own
 * unverified methods. Do not trust the exact field names below until a real call has
 * been placed and the response shape checked against Phase22CallLog rows. Fix this
 * comment once verified (see memory/DECISIONS.md).
 */
var Phase22ExotelVoiceConfig = {
  PROPERTY_KEYS: { accountSid: 'EXOTEL_VOICE_ACCOUNT_SID', apiKey: 'EXOTEL_VOICE_API_KEY', apiToken: 'EXOTEL_VOICE_API_TOKEN', callerId: 'EXOTEL_VOICE_CALLER_ID' },
  require_: function () {
    var properties = PropertiesService.getScriptProperties();
    var self = this;
    var values = {};
    Object.keys(this.PROPERTY_KEYS).forEach(function (field) {
      var key = self.PROPERTY_KEYS[field];
      var value = properties.getProperty(key);
      if (!value) throw new Phase1Error('CONFIGURATION_ERROR', 'Script Property ' + key + ' is not configured.');
      values[field] = value;
    });
    return values;
  }
};

class ExotelVoiceProvider {
  constructor() {
    this.config_ = Phase22ExotelVoiceConfig.require_();
  }

  /**
   * Rings agentPhone first; once answered, Exotel connects the call to leadPhone.
   * `callerId` is optional — pass a location's own ExoPhone (Phase22 supports one per
   * location, e.g. each brand's own number) to have the lead see that brand's number
   * instead of the account-wide default; falls back to `EXOTEL_VOICE_CALLER_ID` when
   * omitted, so single-caller-ID setups need no per-location configuration at all.
   * Returns { callSid, status, callerId }.
   */
  connectCall(agentPhone, leadPhone, callerId) {
    var effectiveCallerId = callerId || this.config_.callerId;
    var response = this.request_('Calls/connect.json', {
      From: agentPhone,
      To: leadPhone,
      CallerId: effectiveCallerId,
      CallType: 'trans' // UNVERIFIED — assumed value for a real-time (non-recorded-prompt) connect call
    });
    var call = response && response.Call; // UNVERIFIED envelope shape
    return {
      callSid: (call && (call.Sid || call.CallSid)) || null,
      status: (call && call.Status) || 'UNKNOWN',
      callerId: effectiveCallerId,
      raw: response
    };
  }

  request_(path, formParams) {
    var url = 'https://api.exotel.com/v1/Accounts/' + encodeURIComponent(this.config_.accountSid) + '/' + path;
    var options = {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(this.config_.apiKey + ':' + this.config_.apiToken) },
      payload: formParams, // Exotel's Voice API takes form-encoded params, not JSON — UrlFetchApp encodes a plain object as application/x-www-form-urlencoded automatically
      muteHttpExceptions: true
    };
    var response = UrlFetchApp.fetch(url, options);
    var status = response.getResponseCode();
    var parsed = null;
    try { parsed = JSON.parse(response.getContentText()); } catch (e) { parsed = response.getContentText(); }
    if (status < 200 || status >= 300) throw new Phase1Error('PROVIDER_ERROR', 'Exotel voice request failed (' + status + '): ' + JSON.stringify(parsed));
    return parsed;
  }
}

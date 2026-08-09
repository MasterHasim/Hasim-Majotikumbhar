/**
 * Phase 3 domain: the WhatsAppProvider contract and Exotel credential config.
 *
 * Phase3ProviderContract is a plain array (like Phase1RepositoryContract /
 * Phase2RepositoryContract), not a base class to `extends` — Phase 2 hit a real bug
 * from a class being `extends`-ed before its file loaded (Apps Script concatenates
 * .gs files alphabetically); a plain contract array sidesteps that entirely since
 * nothing needs to exist yet at file-load time.
 */
var Phase3ProviderContract = ['sendText', 'sendMedia', 'sendTemplate', 'getTemplates', 'createTemplate', 'getMessageStatus', 'processWebhook'];

var Phase3ExotelConfig = {
  PROPERTY_KEYS: { apiKey: 'EXOTEL_API_KEY', apiToken: 'EXOTEL_API_TOKEN', accountSid: 'EXOTEL_ACCOUNT_SID', subdomain: 'EXOTEL_SUBDOMAIN' },
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

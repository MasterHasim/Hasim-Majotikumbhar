/**
 * Phase 4 webhook config. The webhook has no Google Workspace identity to check
 * (Exotel is not a Google-authenticated caller), so authentication is a shared
 * secret token in the URL instead of Phase 1's AccessControl.
 */
var Phase4WebhookConfig = {
  SCRIPT_PROPERTY: 'WEBHOOK_SECRET_TOKEN',
  requireToken_: function () {
    var token = PropertiesService.getScriptProperties().getProperty(this.SCRIPT_PROPERTY);
    if (!token) throw new Phase1Error('CONFIGURATION_ERROR', 'Script Property ' + this.SCRIPT_PROPERTY + ' is not configured.');
    return token;
  }
};

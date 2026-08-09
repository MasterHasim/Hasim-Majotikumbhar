/**
 * The webhook entry point. Apps Script always returns HTTP 200 from doPost — there is
 * no way to set a different status code — so auth/parse/business errors are reflected
 * in the JSON body, not the HTTP status. Every call is logged to the Webhook_Debug_Log
 * sheet tab (params, body, outcome) — much easier to check than the Apps Script
 * Executions panel for a call that didn't come from the editor's Run button — so a
 * real Exotel webhook can be inspected and processWebhook()'s parsing corrected if it
 * doesn't match reality (Exotel's inbound webhook shape is unconfirmed — see
 * memory/DECISIONS.md).
 */
function doPost(e) {
  var params = e && e.parameter;
  var body = e && e.postData && e.postData.contents;
  var outcome;
  try {
    var token = params && params.token;
    if (token !== Phase4WebhookConfig.requireToken_()) { outcome = { status: 'error', message: 'unauthorized' }; return jsonResponse_(outcome); }
    var payload = JSON.parse(body);
    var normalized = new ExotelProvider().processWebhook(payload);
    var result = new Phase4Api().ingestInboundMessage(normalized);
    outcome = { status: 'ok', result: result };
    return jsonResponse_(outcome);
  } catch (err) {
    outcome = { status: 'error', message: err && err.message };
    return jsonResponse_(outcome);
  } finally {
    logWebhookDebug_(params, body, outcome);
  }
}

function jsonResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function logWebhookDebug_(params, body, outcome) {
  try {
    var spreadsheet = SpreadsheetApp.openById(Phase2Spreadsheet.requireSpreadsheetId_());
    var sheet = spreadsheet.getSheetByName('Webhook_Debug_Log');
    if (!sheet) {
      sheet = spreadsheet.insertSheet('Webhook_Debug_Log');
      var header = ['timestamp', 'params', 'body', 'outcome'];
      sheet.getRange(1, 1, sheet.getMaxRows(), header.length).setNumberFormat('@');
      sheet.appendRow(header);
    }
    var values = [new Date().toISOString(), JSON.stringify(params || null), body || '', JSON.stringify(outcome || null)];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setNumberFormat('@').setValues([values]);
  } catch (ignored) {
    // Never let debug logging break the actual webhook response.
  }
}

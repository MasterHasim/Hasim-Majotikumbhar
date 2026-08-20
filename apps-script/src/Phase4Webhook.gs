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
    forwardToWebappParallelRun_(e, body);
  }
}

function jsonResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Parallel-run validation (2026-08-20): best-effort forward of the exact raw webhook
 * body to the new webapp/ backend, so it can independently process the same real
 * traffic this webhook just handled, without ever risking the real response Exotel is
 * waiting on. Off by default -- only fires when the WEBAPP_PARALLEL_RUN_WEBHOOK_URL
 * Script Property is set (the full URL including webapp's own ?token=... query param,
 * set directly in the Apps Script editor, same as every other credential in this
 * project -- never pasted into chat). Clear the property to turn this off instantly.
 *
 * Apps Script's UrlFetchApp has no configurable timeout, so if webapp is ever slow or
 * unreachable this adds real latency to the live webhook response -- acceptable for a
 * deliberate, temporary testing window, not meant to be left on permanently.
 */
function forwardToWebappParallelRun_(e, body) {
  try {
    var url = PropertiesService.getScriptProperties().getProperty('WEBAPP_PARALLEL_RUN_WEBHOOK_URL');
    if (!url) return;
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: (e && e.postData && e.postData.type) || 'application/json',
      payload: body || '',
      muteHttpExceptions: true
    });
  } catch (ignored) {
    // Never let the parallel-run forward affect the real webhook response.
  }
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

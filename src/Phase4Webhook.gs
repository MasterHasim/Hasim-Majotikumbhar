/**
 * The webhook entry point. Apps Script always returns HTTP 200 from doPost — there is
 * no way to set a different status code — so auth/parse/business errors are reflected
 * in the JSON body, not the HTTP status. The raw payload is logged before any
 * processing so a real Exotel webhook can be inspected in the Apps Script Executions
 * panel even if parsing turns out to be wrong (Exotel's inbound webhook shape is
 * unconfirmed — see memory/DECISIONS.md).
 */
function doPost(e) {
  try {
    console.log(JSON.stringify({ params: e && e.parameter, body: e && e.postData && e.postData.contents }));
    var token = e && e.parameter && e.parameter.token;
    if (token !== Phase4WebhookConfig.requireToken_()) return jsonResponse_({ status: 'error', message: 'unauthorized' });
    var payload = JSON.parse(e.postData.contents);
    var normalized = new ExotelProvider().processWebhook(payload);
    var result = new Phase4Api().ingestInboundMessage(normalized);
    return jsonResponse_({ status: 'ok', result: result });
  } catch (err) {
    console.log(JSON.stringify({ error: err && err.message, code: err && err.code }));
    return jsonResponse_({ status: 'error', message: err && err.message });
  }
}

function jsonResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

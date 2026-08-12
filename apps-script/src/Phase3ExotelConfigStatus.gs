/**
 * Non-secret Exotel config status tab. Writes ONLY property names and whether each is
 * set — never the actual key/token/SID values, which stay in Script Properties per
 * docs/SECURITY.md ("Never: ... Google Sheet cells ... Store credentials through
 * appropriate secure configuration"). Call refreshExotelConfigStatus() manually from
 * the Apps Script editor whenever you want the tab to reflect current configuration.
 */
function refreshExotelConfigStatus() {
  var spreadsheet = SpreadsheetApp.openById(Phase2Spreadsheet.requireSpreadsheetId_());
  var sheet = spreadsheet.getSheetByName('Exotel_Config_Status') || spreadsheet.insertSheet('Exotel_Config_Status');
  sheet.clear();
  var properties = PropertiesService.getScriptProperties();
  var rows = [['Property', 'Configured']];
  Object.keys(Phase3ExotelConfig.PROPERTY_KEYS).forEach(function (field) {
    var key = Phase3ExotelConfig.PROPERTY_KEYS[field];
    rows.push([key, properties.getProperty(key) ? 'YES' : 'NO']);
  });
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  return rows;
}

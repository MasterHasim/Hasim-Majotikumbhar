/**
 * Phase 2 persistence: a second repository adapter, alongside Phase 1's
 * PropertiesRepository, both conforming to the same list/get/findOne/create/update/
 * remove/replace/count contract (Phase1RepositoryContract in Phase1Repository.gs).
 *
 * Unlike PropertiesRepository (one instance multiplexes many named collections),
 * SheetRepository is instantiated once per entity/tab, so its methods are not passed
 * a collection name — the instance already knows which tab it owns.
 *
 * Named Phase2Persistence.gs (not Phase2Repository.gs) so it sorts alphabetically
 * before Phase2Repositories.gs: Apps Script loads .gs files in filename order, and
 * `class NumberRepository extends SheetRepository` is evaluated at file-load time, so
 * SheetRepository must already exist by then. "Repositories" < "Repository"
 * alphabetically, so any "Phase2Repository*.gs" name would still load too late.
 *
 * No repository below is wired to any service or endpoint yet. The backing spreadsheet
 * is configured via the SPREADSHEET_ID Script Property (set 2026-08-09, pointing at
 * spreadsheet 1qugfpq7dfNd2phwb8GVh_6VEsDe1Kf0fd76w3JQcqt4).
 */
var Phase2Spreadsheet = {
  SCRIPT_PROPERTY: 'SPREADSHEET_ID',
  requireSpreadsheetId_: function () {
    var id = PropertiesService.getScriptProperties().getProperty(this.SCRIPT_PROPERTY);
    if (!id) throw new Phase1Error('CONFIGURATION_ERROR', 'Script Property ' + this.SCRIPT_PROPERTY + ' is not configured.');
    return id;
  }
};

class SheetRepository {
  constructor(collectionName, columns) {
    this.collectionName_ = collectionName;
    this.columns_ = columns;
  }

  list() { return this.readAll_(this.sheet_()).map(function (row) { return row.record; }); }
  get(id) { var found = this.findRow_(id); return found ? found.record : null; }
  findOne(predicate) {
    var rows = this.readAll_(this.sheet_());
    for (var i = 0; i < rows.length; i++) if (predicate(rows[i].record)) return rows[i].record;
    return null;
  }
  create(record) {
    var self = this;
    return this.mutate_(function (sheet, rows) {
      if (rows.some(function (row) { return row.record.id === record.id; })) throw new Phase1Error('CONFLICT', self.collectionName_ + ' record already exists.');
      self.appendRow_(sheet, record);
      return record;
    });
  }
  update(id, patch) {
    var self = this;
    return this.mutate_(function (sheet, rows) {
      var found = rows.filter(function (row) { return row.record.id === id; })[0];
      if (!found) throw new Phase1Error('NOT_FOUND', self.collectionName_ + ' record was not found.');
      var updated = Object.assign({}, found.record, patch, { id: id, updatedAt: Phase1Ids.now() });
      self.writeRow_(sheet, found.rowIndex, updated);
      return updated;
    });
  }
  remove(id) {
    var self = this;
    return this.mutate_(function (sheet, rows) {
      var found = rows.filter(function (row) { return row.record.id === id; })[0];
      if (!found) throw new Phase1Error('NOT_FOUND', self.collectionName_ + ' record was not found.');
      sheet.deleteRow(found.rowIndex);
      return found.record;
    });
  }
  replace(id, record) {
    var self = this;
    return this.mutate_(function (sheet, rows) {
      var found = rows.filter(function (row) { return row.record.id === id; })[0];
      var full = Object.assign({}, record, { id: id });
      if (found) self.writeRow_(sheet, found.rowIndex, full); else self.appendRow_(sheet, full);
      return full;
    });
  }
  count() { return this.list().length; }

  sheet_() {
    var spreadsheet = SpreadsheetApp.openById(Phase2Spreadsheet.requireSpreadsheetId_());
    var sheet = spreadsheet.getSheetByName(this.collectionName_);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(this.collectionName_);
      var header = ['id'].concat(this.columns_);
      // Force plain-text formatting before any data is written, otherwise Sheets
      // silently coerces numeric-looking strings (e.g. a phone number "000") into
      // actual numbers, losing leading zeros and exact string identity.
      sheet.getRange(1, 1, sheet.getMaxRows(), header.length).setNumberFormat('@');
      sheet.appendRow(header);
    }
    return sheet;
  }
  readAll_(sheet) {
    var values = sheet.getDataRange().getValues();
    var header = values[0] || ['id'].concat(this.columns_);
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var raw = values[r];
      if (!raw[0]) continue;
      var record = {};
      header.forEach(function (field, c) { record[field] = raw[c]; });
      rows.push({ rowIndex: r + 1, record: record });
    }
    return rows;
  }
  findRow_(id) {
    var rows = this.readAll_(this.sheet_());
    return rows.filter(function (row) { return row.record.id === id; })[0] || null;
  }
  appendRow_(sheet, record) {
    var header = ['id'].concat(this.columns_);
    var values = header.map(function (field) { return record[field] !== undefined ? record[field] : ''; });
    // Re-applying '@' directly on the exact target range immediately before the write
    // — a sheet-wide format set once at creation was not enough to reliably stop
    // Sheets from coercing numeric-looking strings (e.g. "000") into numbers.
    var range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length);
    range.setNumberFormat('@');
    range.setValues([values]);
  }
  writeRow_(sheet, rowIndex, record) {
    var header = ['id'].concat(this.columns_);
    var values = header.map(function (field) { return record[field] !== undefined ? record[field] : ''; });
    var range = sheet.getRange(rowIndex, 1, 1, values.length);
    range.setNumberFormat('@');
    range.setValues([values]);
  }
  mutate_(mutator) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sheet = this.sheet_();
      var rows = this.readAll_(sheet);
      return mutator(sheet, rows);
    } finally { lock.releaseLock(); }
  }
}

var Phase2RepositoryContract = ['list', 'get', 'findOne', 'create', 'update', 'remove', 'replace', 'count'];

/**
 * Firebase Realtime Database-backed repository, conforming to the same
 * list/get/findOne/create/update/remove/replace/count contract as SheetRepository
 * and PropertiesRepository (Phase1RepositoryContract) — so MessageRepository/
 * ConversationRepository can extend this instead of SheetRepository with no other
 * code anywhere needing to change (see Phase2Repositories.gs).
 *
 * REST API shape: each record lives at {DATABASE_URL}/{collection}/{id}.json.
 * list() reads the whole collection node in one request (same full-collection-read
 * pattern SheetRepository used — Firebase's per-record fetch is just far cheaper
 * than a Sheets full-table scan, which is the entire point of this migration).
 *
 * Firebase's REST API has no equivalent of SheetRepository's LockService-guarded
 * read-then-write — mutations here wrap the same LockService.getScriptLock() around
 * a fresh GET + PUT to preserve the same single-writer safety property, even though
 * Firebase itself doesn't enforce it for plain REST PUT/PATCH.
 */
class FirebaseRealtimeDbRepository {
  constructor(collectionName) {
    this.collectionName_ = collectionName;
  }

  list() {
    var data = this.request_('get', '');
    if (!data) return [];
    return Object.keys(data).map(function (id) { return data[id]; });
  }
  get(id) { return this.request_('get', '/' + encodeURIComponent(id)); }
  findOne(predicate) {
    var rows = this.list();
    for (var i = 0; i < rows.length; i++) if (predicate(rows[i])) return rows[i];
    return null;
  }
  create(record) {
    var self = this;
    return this.mutate_(function () {
      if (self.get(record.id)) throw new Phase1Error('CONFLICT', self.collectionName_ + ' record already exists.');
      self.request_('put', '/' + encodeURIComponent(record.id), record);
      return record;
    });
  }
  update(id, patch) {
    var self = this;
    return this.mutate_(function () {
      var existing = self.get(id);
      if (!existing) throw new Phase1Error('NOT_FOUND', self.collectionName_ + ' record was not found.');
      var updated = Object.assign({}, existing, patch, { id: id, updatedAt: Phase1Ids.now() });
      self.request_('put', '/' + encodeURIComponent(id), updated);
      return updated;
    });
  }
  remove(id) {
    var self = this;
    return this.mutate_(function () {
      var existing = self.get(id);
      if (!existing) throw new Phase1Error('NOT_FOUND', self.collectionName_ + ' record was not found.');
      self.request_('delete', '/' + encodeURIComponent(id));
      return existing;
    });
  }
  replace(id, record) {
    var self = this;
    return this.mutate_(function () {
      var full = Object.assign({}, record, { id: id });
      self.request_('put', '/' + encodeURIComponent(id), full);
      return full;
    });
  }
  count() { return this.list().length; }

  mutate_(mutator) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try { return mutator(); } finally { lock.releaseLock(); }
  }
  request_(method, path, payload) {
    var options = { method: method, headers: { Authorization: 'Bearer ' + FirebaseConfig_.accessToken_() }, muteHttpExceptions: true };
    if (payload !== undefined) { options.contentType = 'application/json'; options.payload = JSON.stringify(payload); }
    var url = FirebaseConfig_.databaseUrl_() + '/' + this.collectionName_ + path + '.json';
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    // A cached token can be stale (expired early, or — as happened live on
    // 2026-08-11 — issued under a scope that was since corrected) without this
    // code being able to tell in advance. One automatic retry with a forced-fresh
    // token before giving up, rather than requiring a manual Script Property
    // deletion every time this class of issue comes up.
    if (code === 401) {
      FirebaseConfig_.clearTokenCache_();
      options.headers.Authorization = 'Bearer ' + FirebaseConfig_.accessToken_();
      response = UrlFetchApp.fetch(url, options);
      code = response.getResponseCode();
    }
    var text = response.getContentText();
    if (code >= 400) throw new Phase1Error('EXTERNAL_ERROR', 'Firebase request failed (' + code + '): ' + text);
    return text ? JSON.parse(text) : null;
  }
}

var FirebaseRepositoryContract = ['list', 'get', 'findOne', 'create', 'update', 'remove', 'replace', 'count'];

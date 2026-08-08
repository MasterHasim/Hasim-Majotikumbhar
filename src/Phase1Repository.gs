/** Provider-neutral repository contract and initial Script Properties adapter. */
class PropertiesRepository {
  constructor(namespace) { this.namespace_ = namespace || 'wap.phase1.'; }

  list(collection) {
    var records = this.readCollection_(collection);
    return Object.keys(records).map(function (id) { return records[id]; });
  }
  get(collection, id) { return this.readCollection_(collection)[id] || null; }
  findOne(collection, predicate) {
    var records = this.list(collection);
    for (var i = 0; i < records.length; i++) if (predicate(records[i])) return records[i];
    return null;
  }
  create(collection, record) {
    return this.mutate_(collection, function (records) {
      if (records[record.id]) throw new Phase1Error('CONFLICT', collection + ' record already exists.');
      records[record.id] = record;
      return record;
    });
  }
  update(collection, id, patch) {
    return this.mutate_(collection, function (records) {
      if (!records[id]) throw new Phase1Error('NOT_FOUND', collection + ' record was not found.');
      records[id] = Object.assign({}, records[id], patch, { id: id, updatedAt: Phase1Ids.now() });
      return records[id];
    });
  }
  remove(collection, id) {
    return this.mutate_(collection, function (records) {
      if (!records[id]) throw new Phase1Error('NOT_FOUND', collection + ' record was not found.');
      var removed = records[id]; delete records[id]; return removed;
    });
  }
  replace(collection, id, record) {
    return this.mutate_(collection, function (records) { records[id] = record; return record; });
  }
  count(collection) { return this.list(collection).length; }

  readCollection_(collection) {
    var raw = PropertiesService.getScriptProperties().getProperty(this.namespace_ + collection);
    return raw ? JSON.parse(raw) : {};
  }
  mutate_(collection, mutator) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var records = this.readCollection_(collection);
      var result = mutator(records);
      PropertiesService.getScriptProperties().setProperty(this.namespace_ + collection, JSON.stringify(records));
      return result;
    } finally { lock.releaseLock(); }
  }
}

/** The required data contract; services depend on these operations, not storage details. */
var Phase1RepositoryContract = ['list', 'get', 'findOne', 'create', 'update', 'remove', 'replace', 'count'];

/**
 * Phase 3 services: thin, authorized CRUD over NumberRepository (src/Phase2Repositories.gs).
 * First real caller of a Phase 2 repository — mirrors Phase1Api's construction style
 * (src/Phase1Services.gs) so every mutation goes through the same AccessControl and
 * audit log as Phase 1, just against the Sheets-backed NumberRepository instead of
 * PropertiesRepository.
 */
class Phase3Api {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    this.numbers_ = new NumberRepository();
  }
  createNumber(input) {
    var actor = this.access_.require(Phase1Permissions.NUMBERS_ADMIN);
    var displayName = Phase1Validation.requiredString(input.displayName, 'displayName');
    var phoneNumber = Phase1Validation.requiredString(input.phoneNumber, 'phoneNumber');
    if (this.numbers_.findOne(function (number) { return number.phoneNumber === phoneNumber; })) throw new Phase1Error('CONFLICT', 'A number with this phoneNumber already exists.');
    var now = Phase1Ids.now();
    var record = {
      id: Phase1Ids.create('number'), displayName: displayName, phoneNumber: phoneNumber,
      provider: Phase1Validation.requiredString(input.provider, 'provider'),
      providerAccountId: input.providerAccountId || '', wabaId: input.wabaId || '', providerNumberId: input.providerNumberId || '',
      active: input.active !== false, createdAt: now, updatedAt: now
    };
    this.numbers_.create(record);
    this.audit_.write(actor.id, 'number.created', 'number', record.id, {});
    return record;
  }
  updateNumber(id, patch) {
    var actor = this.access_.require(Phase1Permissions.NUMBERS_ADMIN);
    if (!this.numbers_.get(id)) throw new Phase1Error('NOT_FOUND', 'Number was not found.');
    var allowed = ['displayName', 'phoneNumber', 'provider', 'providerAccountId', 'wabaId', 'providerNumberId', 'active'];
    var safePatch = {};
    Object.keys(patch || {}).forEach(function (key) {
      if (allowed.indexOf(key) === -1) throw new Phase1Error('VALIDATION_ERROR', 'Field cannot be updated: ' + key);
      safePatch[key] = patch[key];
    });
    if (Object.keys(safePatch).length === 0) throw new Phase1Error('VALIDATION_ERROR', 'At least one permitted field is required.');
    var record = this.numbers_.update(id, safePatch);
    this.audit_.write(actor.id, 'number.updated', 'number', id, {});
    return record;
  }
  listNumbers() {
    this.access_.require(Phase1Permissions.NUMBERS_ADMIN);
    return this.numbers_.list();
  }
}

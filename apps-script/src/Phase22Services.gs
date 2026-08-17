/**
 * Phase 22 business logic. Round-robin selection (selectNextLocationAgent_) and its
 * locking are a deliberate parallel of Phase7Services.gs's selectNextAgent_ /
 * assignNewLead_ — same wrap-around-with-self-healing rotation, same single-lock
 * read-pointer/select/update-pointer sequence — just keyed by location instead of
 * numberId, and with a `single`/`manual` mode Phase 7 doesn't need (Phase 7 only ever
 * had round-robin-or-fallback).
 */
class Phase22Api {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    this.leads_ = new LeadRepository();
    this.locationAssignment_ = new LocationAssignmentRepository();
    this.callLog_ = new CallLogRepository();
  }

  listLocations() {
    this.access_.currentUser();
    return Phase22Locations.slice();
  }

  /**
   * rows: [{name, phone, location}]. Invalid rows are skipped individually (reported
   * in `errors`, not thrown) so one bad row in a large paste doesn't abort the whole
   * batch — the admin fixes just those rows and re-uploads.
   */
  uploadLeads(rows) {
    var actor = this.access_.require(Phase1Permissions.LEADS_MANAGE);
    if (!Array.isArray(rows) || !rows.length) throw new Phase1Error('VALIDATION_ERROR', 'rows must be a non-empty array.');
    var self = this, batchId = Phase1Ids.create('uploadbatch'), now = Phase1Ids.now();
    var createdCount = 0, skipped = 0, errors = [];
    rows.forEach(function (row, index) {
      try {
        var name = Phase1Validation.requiredString(row.name, 'name');
        var phone = Phase22Validation.phone(row.phone, 'phone');
        var location = Phase22Validation.location(row.location);
        if (self.leads_.findOne(function (lead) { return lead.phone === phone && lead.location === location; })) { skipped++; return; }
        var lead = { id: Phase1Ids.create('lead'), name: name, phone: phone, location: location, status: Phase22LeadStatus.NEW, assignedUserId: '', assignedAt: '', uploadBatchId: batchId, uploadedBy: actor.id, createdAt: now, updatedAt: now };
        self.leads_.create(lead);
        self.assignLead_(lead);
        createdCount++;
      } catch (e) {
        errors.push({ index: index, row: row, message: (e && e.message) || String(e) });
      }
    });
    this.audit_.write(actor.id, 'leads.uploaded', 'leadBatch', batchId, { created: createdCount, skipped: skipped, errors: errors.length });
    return { batchId: batchId, created: createdCount, skipped: skipped, errors: errors };
  }

  reassignLead(leadId, userId) {
    var actor = this.access_.require(Phase1Permissions.LEADS_MANAGE);
    var lead = this.leads_.get(leadId);
    if (!lead) throw new Phase1Error('NOT_FOUND', 'Lead was not found.');
    userId = Phase1Validation.requiredString(userId, 'userId');
    if (!this.repository_.get('users', userId)) throw new Phase1Error('NOT_FOUND', 'User was not found.');
    var record = this.leads_.update(leadId, { status: Phase22LeadStatus.ASSIGNED, assignedUserId: userId, assignedAt: Phase1Ids.now() });
    this.audit_.write(actor.id, 'lead.reassigned', 'lead', leadId, { userId: userId });
    return record;
  }

  /** ADMIN/SITE_MANAGER (LEADS_MANAGE) see every lead; AGENT (LEADS_VIEW_ASSIGNED) sees only their own. */
  listLeads(filters) {
    filters = filters || {};
    var actor = this.access_.currentUser();
    var isManager = this.access_.hasRole(actor, Phase1Roles.ADMIN) || this.access_.hasRole(actor, Phase1Roles.SITE_MANAGER);
    if (isManager) this.access_.require(Phase1Permissions.LEADS_MANAGE);
    else this.access_.require(Phase1Permissions.LEADS_VIEW_ASSIGNED);
    var all = this.leads_.list();
    var scoped = isManager ? all : all.filter(function (lead) { return lead.assignedUserId === actor.id; });
    return scoped.filter(function (lead) {
      if (filters.location && lead.location !== filters.location) return false;
      if (filters.status && lead.status !== filters.status) return false;
      if (filters.assignedUserId && lead.assignedUserId !== filters.assignedUserId) return false;
      return true;
    }).sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
  }

  getLocationConfig(location) {
    this.access_.require(Phase1Permissions.LEADS_MANAGE);
    Phase22Validation.location(location);
    return this.locationAssignment_.config.findOne(function (record) { return record.location === location; }) || null;
  }

  setLocationConfig(location, patch) {
    var actor = this.access_.require(Phase1Permissions.LEADS_MANAGE);
    Phase22Validation.location(location);
    var allowed = ['mode', 'singleUserId', 'active', 'callerId'];
    var safePatch = {};
    Object.keys(patch || {}).forEach(function (key) {
      if (allowed.indexOf(key) === -1) throw new Phase1Error('VALIDATION_ERROR', 'Field cannot be updated: ' + key);
      safePatch[key] = patch[key];
    });
    if (safePatch.mode) Phase22Validation.mode(safePatch.mode);
    if (safePatch.singleUserId && !this.repository_.get('users', safePatch.singleUserId)) throw new Phase1Error('NOT_FOUND', 'singleUserId does not reference a user.');
    if (safePatch.callerId) safePatch.callerId = safePatch.callerId.toString().trim();
    var existing = this.locationAssignment_.config.findOne(function (record) { return record.location === location; });
    var now = Phase1Ids.now(), record;
    if (existing) {
      record = this.locationAssignment_.config.update(existing.id, safePatch);
    } else {
      record = Object.assign({ id: Phase1Ids.create('locconfig'), location: location, mode: Phase22AssignmentModes.MANUAL, singleUserId: '', lastAssignedUserId: '', active: true, callerId: '', createdAt: now, updatedAt: now }, safePatch);
      this.locationAssignment_.config.create(record);
    }
    this.audit_.write(actor.id, 'locationAssignmentConfig.updated', 'locationAssignmentConfig', record.id, { location: location });
    return record;
  }

  listLocationParticipants(location) {
    this.access_.require(Phase1Permissions.LEADS_MANAGE);
    return this.locationAssignment_.users.list().filter(function (p) { return p.location === location; })
      .sort(function (a, b) { return a.sequenceOrder - b.sequenceOrder; });
  }

  addLocationParticipant(location, userId, sequenceOrder) {
    var actor = this.access_.require(Phase1Permissions.LEADS_MANAGE);
    Phase22Validation.location(location);
    if (!this.repository_.get('users', userId)) throw new Phase1Error('NOT_FOUND', 'User was not found.');
    if (this.locationAssignment_.users.findOne(function (p) { return p.location === location && p.userId === userId; })) throw new Phase1Error('CONFLICT', 'User is already a participant for this location.');
    var now = Phase1Ids.now();
    var record = { id: Phase1Ids.create('locuser'), location: location, userId: userId, sequenceOrder: sequenceOrder || 1, active: true, createdAt: now, updatedAt: now };
    this.locationAssignment_.users.create(record);
    this.audit_.write(actor.id, 'locationAssignmentParticipant.added', 'locationAssignmentUser', record.id, { location: location, userId: userId });
    return record;
  }

  updateLocationParticipant(id, patch) {
    var actor = this.access_.require(Phase1Permissions.LEADS_MANAGE);
    if (!this.locationAssignment_.users.get(id)) throw new Phase1Error('NOT_FOUND', 'Location participant was not found.');
    var allowed = ['sequenceOrder', 'active'];
    var safePatch = {};
    Object.keys(patch || {}).forEach(function (key) {
      if (allowed.indexOf(key) === -1) throw new Phase1Error('VALIDATION_ERROR', 'Field cannot be updated: ' + key);
      safePatch[key] = patch[key];
    });
    var record = this.locationAssignment_.users.update(id, safePatch);
    this.audit_.write(actor.id, 'locationAssignmentParticipant.updated', 'locationAssignmentUser', id, {});
    return record;
  }

  /** AGENT-only, and only for a lead assigned to themselves — an admin never places calls through this path. */
  initiateCall(leadId) {
    var actor = this.access_.require(Phase1Permissions.LEADS_CALL);
    var lead = this.leads_.get(leadId);
    if (!lead) throw new Phase1Error('NOT_FOUND', 'Lead was not found.');
    if (lead.assignedUserId !== actor.id) {
      this.audit_.write(actor.id, 'authorization.denied', 'lead', leadId, { reason: 'NOT_ASSIGNED_TO_CALLER' });
      throw new Phase1Error('FORBIDDEN', 'This lead is not assigned to you.');
    }
    var agentPhone = (actor.phone || '').toString().trim();
    if (!agentPhone) throw new Phase1Error('VALIDATION_ERROR', 'Your profile has no phone number on file — ask an admin to add one.');
    var locationConfig = this.locationAssignment_.config.findOne(function (record) { return record.location === lead.location; });
    var result = new ExotelVoiceProvider().connectCall(agentPhone, lead.phone, locationConfig && locationConfig.callerId);
    var now = Phase1Ids.now();
    var record = { id: Phase1Ids.create('call'), leadId: leadId, agentUserId: actor.id, exotelCallSid: result.callSid || '', agentPhone: agentPhone, leadPhone: lead.phone, callerId: result.callerId || '', status: result.status || 'INITIATED', initiatedAt: now, updatedAt: now };
    this.callLog_.create(record);
    this.leads_.update(leadId, { status: Phase22LeadStatus.CALLED });
    this.audit_.write(actor.id, 'lead.called', 'lead', leadId, { callId: record.id, callSid: record.exotelCallSid });
    return record;
  }

  listCallLog(leadId) {
    this.access_.require(Phase1Permissions.LEADS_MANAGE);
    return this.callLog_.list().filter(function (call) { return call.leadId === leadId; })
      .sort(function (a, b) { return (a.initiatedAt || '').localeCompare(b.initiatedAt || ''); });
  }

  assignLead_(lead) {
    var config = this.locationAssignment_.config.findOne(function (record) { return record.location === lead.location; });
    if (!config || config.active !== true || config.mode === Phase22AssignmentModes.MANUAL) {
      return this.leads_.update(lead.id, { status: Phase22LeadStatus.UNASSIGNED });
    }
    if (config.mode === Phase22AssignmentModes.SINGLE) {
      if (!config.singleUserId) return this.leads_.update(lead.id, { status: Phase22LeadStatus.UNASSIGNED });
      return this.finalizeAssignment_(lead, config.singleUserId, 'single');
    }
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var selected = this.selectNextLocationAgent_(lead.location, config);
      if (!selected) return this.leads_.update(lead.id, { status: Phase22LeadStatus.UNASSIGNED });
      this.locationAssignment_.config.update(config.id, { lastAssignedUserId: selected });
      return this.finalizeAssignment_(lead, selected, 'round_robin');
    } finally {
      lock.releaseLock();
    }
  }

  finalizeAssignment_(lead, userId, reason) {
    var record = this.leads_.update(lead.id, { status: Phase22LeadStatus.ASSIGNED, assignedUserId: userId, assignedAt: Phase1Ids.now() });
    this.audit_.write(null, 'lead.assigned', 'lead', lead.id, { userId: userId, reason: reason });
    return record;
  }

  selectNextLocationAgent_(location, config) {
    var self = this;
    var eligible = this.locationAssignment_.users.list().filter(function (p) { return p.location === location && p.active === true; })
      .sort(function (a, b) { return a.sequenceOrder - b.sequenceOrder; })
      .filter(function (p) { var user = self.repository_.get('users', p.userId); return user && user.status === Phase1Constants.ACTIVE; })
      .map(function (p) { return p.userId; });
    if (!eligible.length) return null;
    var lastIndex = eligible.indexOf(config.lastAssignedUserId);
    return eligible[(lastIndex + 1) % eligible.length];
  }
}

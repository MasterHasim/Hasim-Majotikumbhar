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
    this.stages_ = new StageRepository();
    this.leadStages_ = new LeadStageAssignmentRepository();
    this.leadRemarks_ = new LeadRemarkRepository();
    this.customers_ = new CustomerRepository();
    this.conversations_ = new ConversationRepository();
    this.numbers_ = new NumberRepository();
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
    var isManager = this.isLeadManager_(actor);
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
    if (safePatch.callerId) safePatch.callerId = Phase22Validation.callerId(safePatch.callerId);
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

  /**
   * Stage/remarks reuse Phase 8's exact authorization shape (Phase8Api.setCustomerStage/
   * addRemark) — a manager (LEADS_MANAGE) can touch any lead; anyone else needs both the
   * generic permission (LEAD_STAGES_MANAGE/REMARKS_MANAGE — AGENT already has both from
   * Phase 1's original bootstrap, no new permission/fixup needed) AND ownership of that
   * specific lead, so an agent can't touch a lead assigned to someone else.
   */
  setLeadStage(leadId, stageId) {
    var actor = this.access_.require(Phase1Permissions.LEAD_STAGES_MANAGE);
    var lead = this.leads_.get(leadId);
    if (!lead) throw new Phase1Error('NOT_FOUND', 'Lead was not found.');
    if (!this.stages_.get(stageId)) throw new Phase1Error('NOT_FOUND', 'Stage was not found.');
    if (!this.canTouchLead_(actor, lead)) this.access_.denied_(actor, 'lead', leadId, 'NOT_ASSIGNED_TO_CALLER');
    var now = Phase1Ids.now();
    var record = { id: leadId, leadId: leadId, stageId: stageId, setByUserId: actor.id, updatedAt: now };
    this.leadStages_.replace(leadId, record);
    this.audit_.write(actor.id, 'lead.stageChanged', 'lead', leadId, { stageId: stageId });
    return record;
  }

  getLeadStage(leadId) {
    var actor = this.access_.currentUser();
    var lead = this.leads_.get(leadId);
    if (!lead) throw new Phase1Error('NOT_FOUND', 'Lead was not found.');
    if (!this.canTouchLead_(actor, lead)) this.access_.denied_(actor, 'lead', leadId, 'NOT_ASSIGNED_TO_CALLER');
    return this.leadStages_.get(leadId);
  }

  addLeadRemark(leadId, text) {
    var lead = this.leads_.get(leadId);
    if (!lead) throw new Phase1Error('NOT_FOUND', 'Lead was not found.');
    var actor = this.access_.currentUser();
    if (!this.canTouchLead_(actor, lead)) this.access_.denied_(actor, 'lead', leadId, 'NOT_ASSIGNED_TO_CALLER');
    this.access_.require(Phase1Permissions.REMARKS_MANAGE);
    text = Phase1Validation.requiredString(text, 'text');
    var remark = { id: Phase1Ids.create('leadremark'), leadId: leadId, authorUserId: actor.id, text: text, createdAt: Phase1Ids.now() };
    this.leadRemarks_.create(remark);
    this.audit_.write(actor.id, 'leadRemark.added', 'leadRemark', remark.id, { leadId: leadId });
    return remark;
  }

  listLeadRemarks(leadId) {
    var lead = this.leads_.get(leadId);
    if (!lead) throw new Phase1Error('NOT_FOUND', 'Lead was not found.');
    var actor = this.access_.currentUser();
    if (!this.canTouchLead_(actor, lead)) this.access_.denied_(actor, 'lead', leadId, 'NOT_ASSIGNED_TO_CALLER');
    var hasPermission = false;
    try { this.access_.require(Phase1Permissions.REMARKS_VIEW); hasPermission = true; } catch (ignored) {}
    if (!hasPermission) this.access_.require(Phase1Permissions.REMARKS_MANAGE);
    return this.leadRemarks_.list().filter(function (remark) { return remark.leadId === leadId; })
      .sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
  }

  /**
   * Finds/creates a Customer+open Conversation for a lead's own phone number on the
   * WhatsApp number matching its location (findNumberForLocation_), then hands the
   * frontend enough to jump straight into the normal Inbox and start chatting — reuses
   * the existing messaging UI/send pipeline entirely rather than building a parallel one.
   * Only the lead's assigned agent (or a lead manager) can do this, same ownership rule
   * as initiateCall; also requires the agent actually have numberAccess for the resolved
   * WhatsApp number, since Phase 5/6's own authorization would otherwise block them from
   * ever opening the conversation this just created.
   */
  startWhatsAppFromLead(leadId) {
    var actor = this.access_.require(Phase1Permissions.LEADS_CALL);
    var lead = this.leads_.get(leadId);
    if (!lead) throw new Phase1Error('NOT_FOUND', 'Lead was not found.');
    if (!this.canTouchLead_(actor, lead)) this.access_.denied_(actor, 'lead', leadId, 'NOT_ASSIGNED_TO_CALLER');
    var number = this.findNumberForLocation_(lead.location);
    if (!number) throw new Phase1Error('CONFIGURATION_ERROR', 'No WhatsApp number is configured for location "' + lead.location + '" — its display name should include the location name (e.g. "Entartica - ' + lead.location + '").');
    if (!this.access_.hasRole(actor, Phase1Roles.ADMIN) && !this.access_.hasGrantedNumber_(actor.id, number.id)) {
      throw new Phase1Error('FORBIDDEN', 'You do not have access to the ' + number.displayName + ' WhatsApp number yet — ask an admin to grant it under Settings → Number Access.');
    }
    var now = Phase1Ids.now();
    var customer = this.customers_.findOne(function (c) { return c.phone === lead.phone; });
    if (!customer) {
      customer = { id: Phase1Ids.create('customer'), phone: lead.phone, name: lead.name, email: '', company: '', source: 'location_lead', createdAt: now, updatedAt: now };
      this.customers_.create(customer);
    }
    var conversation = this.conversations_.findOne(function (c) { return c.customerId === customer.id && c.numberId === number.id && c.status === 'OPEN'; });
    if (!conversation) {
      conversation = { id: Phase1Ids.create('conversation'), customerId: customer.id, numberId: number.id, assignedUserId: actor.id, status: 'OPEN', needsResponse: false, lastMessageAt: now, createdAt: now, updatedAt: now };
      this.conversations_.create(conversation);
      this.audit_.write(actor.id, 'conversation.createdFromLead', 'conversation', conversation.id, { leadId: leadId });
    }
    return { customerId: customer.id, conversationId: conversation.id, numberId: number.id };
  }

  /** conversation.numberId's own phoneNumber as caller ID — the lead sees the same number they're already chatting with. */
  initiateConversationCall(conversationId) {
    var conversation = this.conversations_.get(conversationId);
    if (!conversation) throw new Phase1Error('NOT_FOUND', 'Conversation was not found.');
    var teamId = this.access_.resolveTeamIdForNumber(conversation.numberId);
    var actor = this.access_.requireConversationOperation('reply', { numberId: conversation.numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });
    var agentPhone = (actor.phone || '').toString().trim();
    if (!agentPhone) throw new Phase1Error('VALIDATION_ERROR', 'Your profile has no phone number on file — ask an admin to add one.');
    var number = this.numbers_.get(conversation.numberId);
    if (!number) throw new Phase1Error('NOT_FOUND', 'Number was not found.');
    var customer = this.customers_.get(conversation.customerId);
    if (!customer) throw new Phase1Error('NOT_FOUND', 'Customer was not found.');
    var result = new ExotelVoiceProvider().connectCall(agentPhone, customer.phone, number.phoneNumber);
    var now = Phase1Ids.now();
    var record = { id: Phase1Ids.create('call'), leadId: '', agentUserId: actor.id, exotelCallSid: result.callSid || '', agentPhone: agentPhone, leadPhone: customer.phone, callerId: result.callerId || '', status: result.status || 'INITIATED', initiatedAt: now, updatedAt: now };
    this.callLog_.create(record);
    this.audit_.write(actor.id, 'conversation.called', 'conversation', conversationId, { callId: record.id, callSid: record.exotelCallSid });
    return record;
  }

  /**
   * Matches a location to a WhatsApp Number by displayName substring (case-insensitive)
   * — e.g. "Entartica - Raipur" for location "Raipur". Deliberately not a stored field:
   * brand/number assignments have already been relabeled once (memory/DECISIONS.md),
   * and this avoids a second config surface to keep in sync.
   *
   * `!== false` (not `=== true`) for the same reason Phase3Services.gs/Phase11Services.gs
   * use it — WhatsApp_Numbers rows have been hand-edited directly in the sheet before
   * (memory/DECISIONS.md), and a manually-typed "TRUE" round-trips through a plain-text
   * (`@`-formatted, see Phase2Persistence.gs) cell as the string "TRUE", not a real
   * boolean — `=== true` would then silently exclude every number.
   */
  findNumberForLocation_(location) {
    var needle = location.toLowerCase();
    return this.numbers_.list().filter(function (n) { return n.active !== false; })
      .find(function (n) { return (n.displayName || '').toLowerCase().indexOf(needle) !== -1; }) || null;
  }

  isLeadManager_(actor) {
    return this.access_.hasRole(actor, Phase1Roles.ADMIN) || this.access_.hasRole(actor, Phase1Roles.SITE_MANAGER);
  }

  canTouchLead_(actor, lead) {
    return this.isLeadManager_(actor) || lead.assignedUserId === actor.id;
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

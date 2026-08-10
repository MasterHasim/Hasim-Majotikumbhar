/**
 * Phase 8 CRM-lite: lead stage definitions (admin-configured), a customer's current
 * stage, and internal remarks on a conversation.
 *
 * Two distinct authorization levels, both already in Phase 1's vocabulary:
 * - Managing the *list* of available stages is admin configuration — gated on
 *   `SETTINGS_MANAGE`, which only ADMIN's role includes (docs/ROADMAP.md: "Admin
 *   configurable... do not hard-code these into application logic").
 * - *Setting* a customer's current stage uses `LEAD_STAGES_MANAGE`, which ADMIN,
 *   SITE_MANAGER, and AGENT all have — but an AGENT must also be able to view at
 *   least one of that customer's conversations (reuses
 *   `requireConversationOperation('view', ...)`), so an agent can't arbitrarily
 *   change the stage of a customer they have no relationship to.
 * - Remarks: adding requires `REMARKS_MANAGE` (ADMIN/SITE_MANAGER/AGENT) plus view
 *   access to the conversation; listing requires `REMARKS_VIEW` or `REMARKS_MANAGE`
 *   (SUPERVISOR has view-only; VIEWER has neither — remarks are internal, not for
 *   read-only external viewers).
 */
class Phase8Api {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    this.stages_ = new StageRepository();
    this.customerStages_ = new CustomerStageRepository();
    this.customers_ = new CustomerRepository();
    this.conversations_ = new ConversationRepository();
    this.remarks_ = new RemarkRepository();
  }

  seedDefaultLeadStages() {
    this.access_.require(Phase1Permissions.SETTINGS_MANAGE);
    if (this.stages_.count() > 0) throw new Phase1Error('CONFLICT', 'Lead stages already exist; seed only runs on an empty list.');
    var now = Phase1Ids.now();
    var self = this;
    return Phase8DefaultStages.map(function (stage, index) {
      var record = { id: Phase1Ids.create('stage'), key: stage.key, name: stage.name, sequenceOrder: index + 1, active: true, createdAt: now, updatedAt: now };
      self.stages_.create(record);
      return record;
    });
  }

  createStage(input) {
    var actor = this.access_.require(Phase1Permissions.SETTINGS_MANAGE);
    var key = Phase1Validation.requiredString(input.key, 'key');
    if (this.stages_.findOne(function (s) { return s.key === key; })) throw new Phase1Error('CONFLICT', 'A stage with this key already exists.');
    var now = Phase1Ids.now();
    var record = { id: Phase1Ids.create('stage'), key: key, name: Phase1Validation.requiredString(input.name, 'name'), sequenceOrder: input.sequenceOrder || (this.stages_.count() + 1), active: input.active !== false, createdAt: now, updatedAt: now };
    this.stages_.create(record);
    this.audit_.write(actor.id, 'leadStage.created', 'leadStage', record.id, {});
    return record;
  }

  updateStage(id, patch) {
    var actor = this.access_.require(Phase1Permissions.SETTINGS_MANAGE);
    if (!this.stages_.get(id)) throw new Phase1Error('NOT_FOUND', 'Stage was not found.');
    var allowed = ['name', 'sequenceOrder', 'active'];
    var safePatch = {};
    Object.keys(patch || {}).forEach(function (key) {
      if (allowed.indexOf(key) === -1) throw new Phase1Error('VALIDATION_ERROR', 'Field cannot be updated: ' + key);
      safePatch[key] = patch[key];
    });
    var record = this.stages_.update(id, safePatch);
    this.audit_.write(actor.id, 'leadStage.updated', 'leadStage', id, {});
    return record;
  }

  listStages() {
    this.access_.currentUser(); // any authenticated user may see the stage list (used for the UI dropdown)
    return this.stages_.list().sort(function (a, b) { return a.sequenceOrder - b.sequenceOrder; });
  }

  setCustomerStage(customerId, stageId) {
    var actor = this.access_.require(Phase1Permissions.LEAD_STAGES_MANAGE);
    if (!this.customers_.get(customerId)) throw new Phase1Error('NOT_FOUND', 'Customer was not found.');
    if (!this.stages_.get(stageId)) throw new Phase1Error('NOT_FOUND', 'Stage was not found.');
    if (!this.access_.hasRole(actor, Phase1Roles.ADMIN) && !this.canSeeCustomer_(actor, customerId)) {
      this.access_.denied_(actor, 'customer', customerId, 'NO_RELATED_CONVERSATION');
    }
    var now = Phase1Ids.now();
    var record = { id: customerId, customerId: customerId, stageId: stageId, setByUserId: actor.id, updatedAt: now };
    this.customerStages_.replace(customerId, record);
    this.audit_.write(actor.id, 'customer.stageChanged', 'customer', customerId, { stageId: stageId });
    return record;
  }

  getCustomerStage(customerId) {
    var actor = this.access_.currentUser();
    if (!this.access_.hasRole(actor, Phase1Roles.ADMIN) && !this.canSeeCustomer_(actor, customerId)) {
      this.access_.denied_(actor, 'customer', customerId, 'NO_RELATED_CONVERSATION');
    }
    return this.customerStages_.get(customerId);
  }

  addRemark(conversationId, text) {
    var conversation = this.conversations_.get(conversationId);
    if (!conversation) throw new Phase1Error('NOT_FOUND', 'Conversation was not found.');
    var teamId = this.access_.resolveTeamIdForNumber(conversation.numberId);
    var actor = this.access_.requireConversationOperation('view', { numberId: conversation.numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });
    this.access_.require(Phase1Permissions.REMARKS_MANAGE);
    text = Phase1Validation.requiredString(text, 'text');
    var remark = { id: Phase1Ids.create('remark'), conversationId: conversationId, authorUserId: actor.id, text: text, createdAt: Phase1Ids.now() };
    this.remarks_.create(remark);
    this.audit_.write(actor.id, 'remark.added', 'remark', remark.id, { conversationId: conversationId });
    return remark;
  }

  listRemarks(conversationId) {
    var conversation = this.conversations_.get(conversationId);
    if (!conversation) throw new Phase1Error('NOT_FOUND', 'Conversation was not found.');
    var teamId = this.access_.resolveTeamIdForNumber(conversation.numberId);
    this.access_.requireConversationOperation('view', { numberId: conversation.numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });
    var hasPermission = false;
    try { this.access_.require(Phase1Permissions.REMARKS_VIEW); hasPermission = true; } catch (ignored) {}
    if (!hasPermission) this.access_.require(Phase1Permissions.REMARKS_MANAGE);
    return this.remarks_.list().filter(function (remark) { return remark.conversationId === conversationId; })
      .sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
  }

  /** Customer directory (2026-08-10, unified-app redesign): ADMIN sees every customer; anyone else sees only customers they have at least one viewable conversation with. */
  listCustomers() {
    var actor = this.access_.currentUser();
    var customers = this.customers_.list();
    if (this.access_.hasRole(actor, Phase1Roles.ADMIN)) return customers;
    var self = this;
    return customers.filter(function (customer) { return self.canSeeCustomer_(actor, customer.id); });
  }

  /** Editing contact details (not phone — that's the identity Phase 4's ingestion matches inbound messages against, so it stays read-only here). Same relationship gate as setCustomerStage. */
  updateCustomer(customerId, patch) {
    var actor = this.access_.currentUser();
    if (!this.customers_.get(customerId)) throw new Phase1Error('NOT_FOUND', 'Customer was not found.');
    if (!this.access_.hasRole(actor, Phase1Roles.ADMIN) && !this.canSeeCustomer_(actor, customerId)) {
      this.access_.denied_(actor, 'customer', customerId, 'NO_RELATED_CONVERSATION');
    }
    var allowed = ['name', 'email', 'company'];
    var safePatch = {};
    Object.keys(patch || {}).forEach(function (key) {
      if (allowed.indexOf(key) === -1) throw new Phase1Error('VALIDATION_ERROR', 'Field cannot be updated: ' + key);
      safePatch[key] = patch[key];
    });
    var record = this.customers_.update(customerId, safePatch);
    this.audit_.write(actor.id, 'customer.updated', 'customer', customerId, {});
    return record;
  }

  canSeeCustomer_(actor, customerId) {
    var self = this;
    return this.conversations_.list().filter(function (c) { return c.customerId === customerId; }).some(function (conversation) {
      try {
        var teamId = self.access_.resolveTeamIdForNumber(conversation.numberId);
        self.access_.requireConversationOperation('view', { numberId: conversation.numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });
        return true;
      } catch (denied) {
        return false;
      }
    });
  }
}

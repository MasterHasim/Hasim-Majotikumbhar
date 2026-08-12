/**
 * Phase 12 Admin Panel & Configuration.
 *
 * Most of the roadmap's Admin Panel sections (Users, Teams, WhatsApp Numbers, Number
 * Access, Lead Stages, Quick Replies, Templates, Audit Logs) already have a full
 * authorized service layer from their own phase (Phase 1/3/8/10/11) — Phase 12 gives
 * them a UI, not new endpoints. That UI originally lived in its own page
 * (frontend/Admin.html, at `?page=admin`); as of 2026-08-10 it was folded into the
 * single unified app (frontend/Index.html) as sidebar sections — see
 * memory/DECISIONS.md.
 *
 * The one genuinely new backend gap: Number_Assignment_Config /
 * Number_Assignment_Users (Phase 2's schema) had no admin-facing CRUD at all — only
 * Phase 7's engine ever read them, and only tests ever wrote them directly. Phase12Api
 * closes that gap, gated on NUMBERS_ADMIN (same permission that already gates
 * WhatsApp_Numbers CRUD in Phase 3 — configuring how a number assigns leads is the
 * same class of admin operation as configuring the number itself).
 */
class Phase12Api {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    this.numberAssignment_ = new AccessRepository();
    this.numbers_ = new NumberRepository();
    this.conversations_ = new ConversationRepository();
  }

  getNumberAssignmentConfig(numberId) {
    this.access_.require(Phase1Permissions.NUMBERS_ADMIN);
    return this.numberAssignment_.config.findOne(function (record) { return record.numberId === numberId; }) || null;
  }

  setNumberAssignmentConfig(numberId, patch) {
    var actor = this.access_.require(Phase1Permissions.NUMBERS_ADMIN);
    if (!this.numbers_.get(numberId)) throw new Phase1Error('NOT_FOUND', 'Number was not found.');
    var allowed = ['roundRobinEnabled', 'fallbackUserId', 'workingHoursStart', 'workingHoursEnd'];
    var safePatch = {};
    Object.keys(patch || {}).forEach(function (key) {
      if (allowed.indexOf(key) === -1) throw new Phase1Error('VALIDATION_ERROR', 'Field cannot be updated: ' + key);
      safePatch[key] = patch[key];
    });
    var existing = this.numberAssignment_.config.findOne(function (record) { return record.numberId === numberId; });
    var now = Phase1Ids.now(), record;
    if (existing) {
      record = this.numberAssignment_.config.update(existing.id, safePatch);
    } else {
      record = Object.assign({ id: Phase1Ids.create('assignconfig'), numberId: numberId, roundRobinEnabled: false, fallbackUserId: '', workingHoursStart: '', workingHoursEnd: '', lastAssignedUserId: '', createdAt: now, updatedAt: now }, safePatch);
      this.numberAssignment_.config.create(record);
    }
    this.audit_.write(actor.id, 'assignmentConfig.updated', 'numberAssignmentConfig', record.id, { numberId: numberId });
    return record;
  }

  listAssignmentParticipants(numberId) {
    this.access_.require(Phase1Permissions.NUMBERS_ADMIN);
    return this.numberAssignment_.users.list().filter(function (participant) { return participant.numberId === numberId; })
      .sort(function (a, b) { return a.sequenceOrder - b.sequenceOrder; });
  }

  addAssignmentParticipant(numberId, userId, sequenceOrder) {
    var actor = this.access_.require(Phase1Permissions.NUMBERS_ADMIN);
    if (!this.numbers_.get(numberId)) throw new Phase1Error('NOT_FOUND', 'Number was not found.');
    if (!this.repository_.get('users', userId)) throw new Phase1Error('NOT_FOUND', 'User was not found.');
    if (this.numberAssignment_.users.findOne(function (p) { return p.numberId === numberId && p.userId === userId; })) throw new Phase1Error('CONFLICT', 'User is already a participant for this number.');
    var now = Phase1Ids.now();
    var record = { id: Phase1Ids.create('assignuser'), numberId: numberId, userId: userId, sequenceOrder: sequenceOrder || 1, active: true, createdAt: now, updatedAt: now };
    this.numberAssignment_.users.create(record);
    this.audit_.write(actor.id, 'assignmentParticipant.added', 'numberAssignmentUser', record.id, { numberId: numberId, userId: userId });
    return record;
  }

  updateAssignmentParticipant(id, patch) {
    var actor = this.access_.require(Phase1Permissions.NUMBERS_ADMIN);
    if (!this.numberAssignment_.users.get(id)) throw new Phase1Error('NOT_FOUND', 'Assignment participant was not found.');
    var allowed = ['sequenceOrder', 'active'];
    var safePatch = {};
    Object.keys(patch || {}).forEach(function (key) {
      if (allowed.indexOf(key) === -1) throw new Phase1Error('VALIDATION_ERROR', 'Field cannot be updated: ' + key);
      safePatch[key] = patch[key];
    });
    var record = this.numberAssignment_.users.update(id, safePatch);
    this.audit_.write(actor.id, 'assignmentParticipant.updated', 'numberAssignmentUser', id, {});
    return record;
  }

  /** Small landing-page counts for the Admin Panel — not Phase 14's analytics (trends/response times), just current totals, so this doesn't step on that future phase's scope. */
  getDashboardSummary() {
    this.access_.require(Phase1Permissions.SETTINGS_MANAGE);
    var conversations = this.conversations_.list();
    return {
      numbers: this.numbers_.count(),
      users: this.repository_.count('users'),
      openConversations: conversations.filter(function (c) { return c.status === 'OPEN'; }).length,
      unassigned: conversations.filter(function (c) { return c.status === 'OPEN' && !c.assignedUserId; }).length,
      needsResponse: conversations.filter(function (c) { return c.status === 'OPEN' && c.needsResponse; }).length
    };
  }
}

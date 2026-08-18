/**
 * Phase 7 assignment & round-robin engine.
 *
 * "New lead" = a genuinely new customer's first-ever conversation → goes through
 * round robin. A returning customer's new conversation (e.g. after a prior one
 * closed) inherits their most recent prior owner instead — "existing customers
 * retain their current owner unless manually reassigned" (docs/ROADMAP.md, Phase 7).
 *
 * Round-robin state: Number_Assignment_Config.lastAssignedUserId (added in this
 * phase — Phase 2's original schema didn't have a rotation pointer since nothing
 * used it yet). Next agent = the one after lastAssignedUserId in the current
 * eligible list (by Number_Assignment_Users.sequenceOrder), wrapping around; if
 * lastAssignedUserId isn't in the current eligible list (removed, no longer
 * eligible, etc.) rotation just starts from the front — self-healing, no drift.
 *
 * Eligibility for a given number requires ALL of: user status active, an explicit
 * numberAccess grant, an explicit assignmentEligibility grant (Phase 1's existing
 * per-user/per-number record), and availability status 'available'. Each is an
 * independent concept per Phase 1's design (docs/REQUIREMENTS.md) — none implies
 * another.
 *
 * The whole read-pointer → select → update-pointer sequence is wrapped in a single
 * LockService lock (docs/ROADMAP.md's explicit concurrency requirement), so two
 * near-simultaneous new leads can never land on the same agent.
 */
class Phase7Api {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    this.conversations_ = new ConversationRepository();
    this.assignments_ = new AssignmentRepository();
    this.numberAssignment_ = new AccessRepository();
  }

  /** Called by Phase 4 right after a brand-new conversation is created. */
  assignConversation(conversation, isNewCustomer) {
    if (!isNewCustomer) {
      var priorOwner = this.determinePriorOwner_(conversation.customerId);
      if (priorOwner) {
        this.conversations_.update(conversation.id, { assignedUserId: priorOwner });
        this.recordAssignment_(conversation.id, priorOwner, null, 'returning_customer');
        return priorOwner;
      }
    }
    return this.assignNewLead_(conversation);
  }

  reassignConversation(conversationId, newUserId) {
    var conversation = this.conversations_.get(conversationId);
    if (!conversation) throw new Phase1Error('NOT_FOUND', 'Conversation was not found.');
    var teamId = this.access_.resolveTeamIdForNumber(conversation.numberId);
    var actor = this.access_.requireConversationOperation('reassign', { numberId: conversation.numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });
    newUserId = Phase1Validation.requiredString(newUserId, 'newUserId');
    if (!this.repository_.get('users', newUserId)) throw new Phase1Error('NOT_FOUND', 'User was not found.');
    this.conversations_.update(conversationId, { assignedUserId: newUserId });
    this.recordAssignment_(conversationId, newUserId, actor.id, 'manual');
    return this.conversations_.get(conversationId);
  }

  /**
   * Phase 12: the properly role-scoped user list a "Reassign…" control needs, deferred
   * from Phase 7 (see memory/DECISIONS.md) because Phase1Api.listUsers is ADMIN-only.
   * ADMIN gets every active user; SUPERVISOR/SITE_MANAGER get active members of the
   * team that covers numberId (same team-scope resolution requireConversationOperation
   * uses); anyone else is denied.
   */
  listAssignableUsers(numberId) {
    var actor = this.access_.currentUser();
    if (this.access_.hasRole(actor, Phase1Roles.ADMIN)) {
      return this.repository_.list('users').filter(function (user) { return user.status === Phase1Constants.ACTIVE; });
    }
    var teamId = this.access_.resolveTeamIdForNumber(numberId);
    if (!teamId) this.access_.denied_(actor, 'number', numberId, 'NO_TEAM_SCOPE');
    this.access_.requireTeamOperation(Phase1Permissions.CONVERSATIONS_REASSIGN_TEAM, teamId);
    var repository = this.repository_;
    var memberUserIds = repository.list('teamMembers').filter(function (member) {
      return member.teamId === teamId && member.status === Phase1Constants.ACTIVE && (member.numberIds.length === 0 || member.numberIds.indexOf(numberId) !== -1);
    }).map(function (member) { return member.userId; });
    return memberUserIds.map(function (userId) { return repository.get('users', userId); }).filter(function (user) { return user && user.status === Phase1Constants.ACTIVE; });
  }

  listAssignmentHistory(conversationId) {
    var conversation = this.conversations_.get(conversationId);
    if (!conversation) throw new Phase1Error('NOT_FOUND', 'Conversation was not found.');
    var teamId = this.access_.resolveTeamIdForNumber(conversation.numberId);
    this.access_.requireConversationOperation('view', { numberId: conversation.numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });
    return this.assignments_.list().filter(function (record) { return record.conversationId === conversationId; })
      .sort(function (a, b) { return (a.assignedAt || '').localeCompare(b.assignedAt || ''); });
  }

  assignNewLead_(conversation) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var config = this.numberAssignment_.config.findOne(function (record) { return record.numberId === conversation.numberId; });
      if (!config || config.roundRobinEnabled !== true || !this.isWithinWorkingHours_(config)) {
        return this.applyFallbackOrLeaveUnassigned_(conversation, config);
      }
      var selectedUserId = this.selectNextAgent_(conversation.numberId, config);
      if (!selectedUserId) return this.applyFallbackOrLeaveUnassigned_(conversation, config);
      this.conversations_.update(conversation.id, { assignedUserId: selectedUserId });
      this.numberAssignment_.config.update(config.id, { lastAssignedUserId: selectedUserId });
      this.recordAssignment_(conversation.id, selectedUserId, null, 'round_robin');
      return selectedUserId;
    } finally {
      lock.releaseLock();
    }
  }

  applyFallbackOrLeaveUnassigned_(conversation, config) {
    var fallback = config && config.fallbackUserId;
    if (fallback) {
      this.conversations_.update(conversation.id, { assignedUserId: fallback });
      this.recordAssignment_(conversation.id, fallback, null, 'fallback');
      return fallback;
    }
    return null;
  }

  determinePriorOwner_(customerId) {
    var priorConversations = this.conversations_.list().filter(function (conversation) { return conversation.customerId === customerId && conversation.assignedUserId; });
    if (!priorConversations.length) return null;
    priorConversations.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    return priorConversations[0].assignedUserId;
  }

  selectNextAgent_(numberId, config) {
    var eligible = this.getEligibleAgentIds_(numberId);
    if (!eligible.length) return null;
    var lastIndex = eligible.indexOf(config.lastAssignedUserId);
    return eligible[(lastIndex + 1) % eligible.length];
  }

  getEligibleAgentIds_(numberId) {
    var self = this;
    // `!== false`, not `=== true` — Number_Assignment_Users is Sheets-backed, and a
    // manually-typed "TRUE" round-trips through the plain-text-formatted `active`
    // column as the string "TRUE", not a boolean (same real bug found live 2026-08-17
    // on WhatsApp_Numbers, see memory/DECISIONS.md; fixed here proactively).
    var participants = this.numberAssignment_.users.list().filter(function (participant) { return participant.numberId === numberId && participant.active !== false; })
      .sort(function (a, b) { return a.sequenceOrder - b.sequenceOrder; });
    return participants.filter(function (participant) {
      var user = self.repository_.get('users', participant.userId);
      if (!user || user.status !== Phase1Constants.ACTIVE) return false;
      var eligibility = self.repository_.get('assignmentEligibility', participant.userId + ':' + numberId);
      if (!eligibility || eligibility.eligible !== true) return false;
      var availability = self.repository_.get('availability', participant.userId);
      if (!availability || availability.status !== Phase1Constants.AVAILABLE) return false;
      var grant = self.repository_.findOne('numberAccess', function (item) { return item.userId === participant.userId && item.numberId === numberId && item.status === Phase1Constants.ACTIVE && item.granted === true; });
      return !!grant;
    }).map(function (participant) { return participant.userId; });
  }

  /** HH:MM string comparison in Asia/Kolkata; unconfigured start/end means no restriction. Doesn't handle overnight ranges (e.g. 22:00-06:00) — not needed by any current number. */
  isWithinWorkingHours_(config) {
    if (!config || !config.workingHoursStart || !config.workingHoursEnd) return true;
    var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'HH:mm');
    return now >= config.workingHoursStart && now <= config.workingHoursEnd;
  }

  recordAssignment_(conversationId, userId, assignedBy, reason) {
    var now = Phase1Ids.now();
    this.assignments_.create({ id: Phase1Ids.create('assignment'), conversationId: conversationId, userId: userId, assignedBy: assignedBy || '', assignedAt: now, reason: reason });
    this.audit_.write(assignedBy || null, 'conversation.assigned', 'conversation', conversationId, { userId: userId, reason: reason });
  }
}

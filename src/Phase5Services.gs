/**
 * Phase 5 inbox: view-only. No reply/send (Phase 6), no round-robin assignment
 * (Phase 7), no stage/remarks/reminders (Phase 8/9 — those entities exist in storage
 * but have no service layer yet).
 *
 * Every non-admin role, including SUPERVISOR/SITE_MANAGER, needs an explicit
 * numberAccess grant before anything else is checked (AccessControl.hasGrantedNumber_,
 * src/Phase1AccessControl.gs) — that's the uniform gate for "which numbers can I see."
 * Team membership's numberIds is a separate, additional scope used only for the
 * team-view path (SUPERVISOR/SITE_MANAGER), resolved via
 * AccessControl.resolveTeamIdForNumber() since Conversations (Phase 2) has no teamId
 * field of its own — see memory/DECISIONS.md.
 */
class Phase5Api {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    this.numbers_ = new NumberRepository();
    this.customers_ = new CustomerRepository();
    this.conversations_ = new ConversationRepository();
    this.messages_ = new MessageRepository();
  }

  listMyNumbers() {
    var actor = this.access_.currentUser();
    if (this.access_.hasRole(actor, Phase1Roles.ADMIN)) return this.numbers_.list();
    var grantedNumberIds = {};
    this.repository_.list('numberAccess').filter(function (grant) {
      return grant.userId === actor.id && grant.status === Phase1Constants.ACTIVE && grant.granted === true;
    }).forEach(function (grant) { grantedNumberIds[grant.numberId] = true; });
    return this.numbers_.list().filter(function (number) { return grantedNumberIds[number.id]; });
  }

  listConversations(numberId) {
    Phase1Validation.requiredString(numberId, 'numberId');
    var actor = this.access_.currentUser();
    // Upfront gate, matching the same tamper-protection AccessControl itself enforces
    // first (src/Phase1AccessControl.gs:42) — a completely inaccessible numberId is an
    // explicit FORBIDDEN, not a silently empty list (which the per-conversation filter
    // below would otherwise produce, indistinguishable from "no conversations yet").
    if (!this.access_.hasRole(actor, Phase1Roles.ADMIN) && !this.access_.hasGrantedNumber_(actor.id, numberId)) {
      this.access_.denied_(actor, 'number', numberId, 'NUMBER_ACCESS');
    }
    var teamId = this.access_.resolveTeamIdForNumber(numberId);
    var self = this;
    return this.conversations_.list().filter(function (conversation) { return conversation.numberId === numberId; })
      .filter(function (conversation) {
        try {
          self.access_.requireConversationOperation('view', { numberId: numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });
          return true;
        } catch (deniedOrInvalid) {
          return false;
        }
      });
  }

  getConversationDetail(conversationId) {
    var conversation = this.conversations_.get(conversationId);
    if (!conversation) throw new Phase1Error('NOT_FOUND', 'Conversation was not found.');
    var teamId = this.access_.resolveTeamIdForNumber(conversation.numberId);
    this.access_.requireConversationOperation('view', { numberId: conversation.numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });

    var customer = this.customers_.get(conversation.customerId);
    var number = this.numbers_.get(conversation.numberId);
    var messages = this.messages_.list().filter(function (message) { return message.conversationId === conversationId; })
      .sort(function (a, b) { return (a.timestamp || '').localeCompare(b.timestamp || ''); });
    return { conversation: conversation, customer: customer, number: number, messages: messages };
  }
}

/**
 * Phase 9 reminders & snooze. Both gated on `REMINDERS_MANAGE` (ADMIN/SITE_MANAGER/
 * AGENT per Phase 1's existing role definitions) plus conversation-view access —
 * same pattern as Phase 8's remarks. Reminder statuses: PENDING/COMPLETED/CANCELLED.
 * Snooze is a distinct concept: it doesn't touch Reminders at all, just marks a
 * conversation to (auto-)disappear from Phase 5's active list until `snoozedUntil`.
 */
class Phase9Api {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    this.reminders_ = new ReminderRepository();
    this.snoozes_ = new ConversationSnoozeRepository();
    this.conversations_ = new ConversationRepository();
  }

  createReminder(conversationId, text, dueAt) {
    var actor = this.requireReminderAccess_(conversationId);
    text = Phase1Validation.requiredString(text, 'text');
    dueAt = Phase1Validation.requiredString(dueAt, 'dueAt');
    var now = Phase1Ids.now();
    var reminder = { id: Phase1Ids.create('reminder'), conversationId: conversationId, ownerUserId: actor.id, text: text, dueAt: dueAt, status: 'PENDING', createdAt: now, updatedAt: now };
    this.reminders_.create(reminder);
    this.audit_.write(actor.id, 'reminder.created', 'reminder', reminder.id, { conversationId: conversationId });
    return reminder;
  }

  updateReminderStatus(reminderId, status) {
    var reminder = this.reminders_.get(reminderId);
    if (!reminder) throw new Phase1Error('NOT_FOUND', 'Reminder was not found.');
    var actor = this.requireReminderAccess_(reminder.conversationId);
    status = Phase1Validation.enumValue(status, ['PENDING', 'COMPLETED', 'CANCELLED'], 'status');
    var record = this.reminders_.update(reminderId, { status: status });
    this.audit_.write(actor.id, 'reminder.statusChanged', 'reminder', reminderId, { status: status });
    return record;
  }

  listReminders(conversationId) {
    this.requireReminderView_(conversationId);
    return this.reminders_.list().filter(function (reminder) { return reminder.conversationId === conversationId; })
      .sort(function (a, b) { return (a.dueAt || '').localeCompare(b.dueAt || ''); });
  }

  /** Pending reminders owned by the signed-in user, across all their conversations — a simple personal follow-up list. */
  listMyReminders() {
    var actor = this.access_.currentUser();
    return this.reminders_.list().filter(function (reminder) { return reminder.ownerUserId === actor.id && reminder.status === 'PENDING'; })
      .sort(function (a, b) { return (a.dueAt || '').localeCompare(b.dueAt || ''); });
  }

  snoozeConversation(conversationId, until) {
    var actor = this.requireReminderAccess_(conversationId);
    until = Phase1Validation.requiredString(until, 'until');
    var record = { id: conversationId, conversationId: conversationId, snoozedUntil: until, snoozedByUserId: actor.id, createdAt: Phase1Ids.now() };
    this.snoozes_.replace(conversationId, record);
    this.audit_.write(actor.id, 'conversation.snoozed', 'conversation', conversationId, { until: until });
    return record;
  }

  unsnoozeConversation(conversationId) {
    var actor = this.requireReminderAccess_(conversationId);
    if (this.snoozes_.get(conversationId)) this.snoozes_.remove(conversationId);
    this.audit_.write(actor.id, 'conversation.unsnoozed', 'conversation', conversationId, {});
    return { conversationId: conversationId, snoozed: false };
  }

  getSnoozeStatus(conversationId) {
    this.requireReminderView_(conversationId);
    var record = this.snoozes_.get(conversationId);
    if (!record || record.snoozedUntil <= Phase1Ids.now()) return { snoozed: false };
    return { snoozed: true, snoozedUntil: record.snoozedUntil };
  }

  requireReminderAccess_(conversationId) {
    var conversation = this.conversations_.get(conversationId);
    if (!conversation) throw new Phase1Error('NOT_FOUND', 'Conversation was not found.');
    var teamId = this.access_.resolveTeamIdForNumber(conversation.numberId);
    this.access_.requireConversationOperation('view', { numberId: conversation.numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });
    return this.access_.require(Phase1Permissions.REMINDERS_MANAGE);
  }

  requireReminderView_(conversationId) {
    var conversation = this.conversations_.get(conversationId);
    if (!conversation) throw new Phase1Error('NOT_FOUND', 'Conversation was not found.');
    var teamId = this.access_.resolveTeamIdForNumber(conversation.numberId);
    return this.access_.requireConversationOperation('view', { numberId: conversation.numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });
  }
}

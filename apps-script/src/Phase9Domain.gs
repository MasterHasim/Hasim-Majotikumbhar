/**
 * Shared helper (not class-scoped) so Phase 5's conversation list can exclude
 * currently-snoozed conversations without a full Phase9Api instance. Snooze
 * auto-expires by comparison, not a scheduled job — once `snoozedUntil` is in the
 * past, the conversation is simply active again on the next read.
 */
function isConversationSnoozed_(conversationId) {
  var record = new ConversationSnoozeRepository().get(conversationId);
  if (!record) return false;
  return record.snoozedUntil > Phase1Ids.now();
}

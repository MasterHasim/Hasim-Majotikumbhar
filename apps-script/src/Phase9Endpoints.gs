/** Public Phase 9 entry points. */
function phase9Api_() { return new Phase9Api(); }
function createReminder(conversationId, text, dueAt) { return phase9Api_().createReminder(conversationId, text, dueAt); }
function updateReminderStatus(reminderId, status) { return phase9Api_().updateReminderStatus(reminderId, status); }
function listReminders(conversationId) { return phase9Api_().listReminders(conversationId); }
function listMyReminders(numberId) { return phase9Api_().listMyReminders(numberId); }
function snoozeConversation(conversationId, until) { return phase9Api_().snoozeConversation(conversationId, until); }
function unsnoozeConversation(conversationId) { return phase9Api_().unsnoozeConversation(conversationId); }
function getSnoozeStatus(conversationId) { return phase9Api_().getSnoozeStatus(conversationId); }

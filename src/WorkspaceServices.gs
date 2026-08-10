/**
 * WorkspaceApi: a single-round-trip aggregator for the inbox detail pane. Added
 * 2026-08-10 at the user's explicit request — opening one conversation was firing 8
 * separate `google.script.run` calls (getConversationDetail, getCustomerStage,
 * listRemarks, listReminders, getSnoozeStatus, listTemplates, listQuickReplies,
 * listAssignableUsers), and each is its own Apps Script execution with real
 * cold-start overhead, which is the actual cause of the reported "slow transitions"
 * — not animation/rendering. This doesn't add new business logic or new
 * authorization rules: it composes each already-authorized PhaseNApi exactly as
 * Phase13Api does, so the "who can see what" decision still lives in exactly one
 * place per entity.
 *
 * Fields the caller isn't authorized to see (e.g. a VIEWER has no remarks access, an
 * AGENT with no team-reassignment scope has no assignableUsers) come back as
 * null/empty rather than failing the whole call — same "hide, don't error" UX the
 * individual panels already had.
 */
class WorkspaceApi {
  constructor() {
    this.phase5_ = new Phase5Api();
    this.phase7_ = new Phase7Api();
    this.phase8_ = new Phase8Api();
    this.phase9_ = new Phase9Api();
  }

  getConversationWorkspace(conversationId) {
    var detail = this.phase5_.getConversationDetail(conversationId);
    var workspace = { conversation: detail.conversation, customer: detail.customer, number: detail.number, messages: detail.messages };

    try { workspace.stage = this.phase8_.getCustomerStage(detail.customer.id); } catch (ignored) { workspace.stage = null; }
    try { workspace.remarks = this.phase8_.listRemarks(conversationId); } catch (ignored) { workspace.remarks = null; }
    try { workspace.reminders = this.phase9_.listReminders(conversationId); } catch (ignored) { workspace.reminders = null; }
    try { workspace.snoozeStatus = this.phase9_.getSnoozeStatus(conversationId); } catch (ignored) { workspace.snoozeStatus = null; }
    try { workspace.assignableUsers = this.phase7_.listAssignableUsers(detail.conversation.numberId); } catch (ignored) { workspace.assignableUsers = []; }

    return workspace;
  }
}

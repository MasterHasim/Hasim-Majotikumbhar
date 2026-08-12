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
 *
 * workspace.realtime (added 2026-08-11) folds in the Firebase listen token
 * (RealtimeListenApi) instead of making the client fetch it as its own separate
 * google.script.run call. Opening a conversation was already firing this call
 * alongside getConversationWorkspace — one more concurrent Apps Script execution
 * competing with everything else a fresh page/conversation load fires (listTemplates,
 * listQuickReplies, listStages, etc.), which is the same "N separate round trips"
 * problem this whole aggregator exists to avoid.
 *
 * Only minted when includeRealtime is true (client passes this on the initial
 * conversation-open call only, see loadWorkspace()/startRealtime in Index.html) —
 * NOT on every action-triggered quiet refresh (reply/note/assign/resolve/etc, 8+
 * call sites), which never uses the token anyway. Minting it unconditionally on
 * every one of those calls added real per-call latency (RSA-signing a fresh
 * custom token) to actions that don't need it, which is exactly the kind of added
 * cost this aggregator exists to avoid.
 */
class WorkspaceApi {
  constructor() {
    this.phase5_ = new Phase5Api();
    this.phase7_ = new Phase7Api();
    this.phase8_ = new Phase8Api();
    this.phase9_ = new Phase9Api();
    this.repository_ = new PropertiesRepository();
    this.messageMedia_ = new MessageMediaRepository();
    this.realtime_ = new RealtimeListenApi();
  }

  getConversationWorkspace(conversationId, includeRealtime) {
    var detail = this.phase5_.getConversationDetail(conversationId);
    var assignedUser = detail.conversation.assignedUserId ? this.repository_.get('users', detail.conversation.assignedUserId) : null;
    var workspace = {
      conversation: detail.conversation, customer: detail.customer, number: detail.number,
      messages: this.enrichMessages_(detail.messages), assignedUserName: assignedUser ? assignedUser.displayName : null
    };

    try { workspace.stage = this.phase8_.getCustomerStage(detail.customer.id); } catch (ignored) { workspace.stage = null; }
    try { workspace.remarks = this.phase8_.listRemarks(conversationId); } catch (ignored) { workspace.remarks = null; }
    try { workspace.reminders = this.phase9_.listReminders(conversationId); } catch (ignored) { workspace.reminders = null; }
    try { workspace.snoozeStatus = this.phase9_.getSnoozeStatus(conversationId); } catch (ignored) { workspace.snoozeStatus = null; }
    try { workspace.assignableUsers = this.phase7_.listAssignableUsers(detail.conversation.numberId); } catch (ignored) { workspace.assignableUsers = []; }
    if (includeRealtime) {
      try { workspace.realtime = this.realtime_.getRealtimeListenToken(); } catch (ignored) { workspace.realtime = null; }
    }

    return workspace;
  }

  /** Adds senderName (who actually sent an OUTBOUND message — "Rahul replied at 2:41 PM," per the roadmap) and media (image/document/etc, if any) to each message, so the client renders both without extra round-trips. */
  enrichMessages_(messages) {
    var repository = this.repository_;
    var userNameCache = {};
    var mediaByMessageId = {};
    var messageIds = {};
    messages.forEach(function (m) { messageIds[m.id] = true; });
    this.messageMedia_.list().forEach(function (media) { if (messageIds[media.messageId]) mediaByMessageId[media.messageId] = media; });

    return messages.map(function (message) {
      var senderName = null;
      if (message.senderUserId) {
        if (!(message.senderUserId in userNameCache)) {
          var user = repository.get('users', message.senderUserId);
          userNameCache[message.senderUserId] = user ? user.displayName : null;
        }
        senderName = userNameCache[message.senderUserId];
      }
      var media = mediaByMessageId[message.id];
      return Object.assign({}, message, {
        senderName: senderName,
        media: media ? { mediaType: media.mediaType, mediaUrl: media.mediaUrl, caption: media.caption } : null
      });
    });
  }
}

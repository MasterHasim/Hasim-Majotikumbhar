/**
 * Phase 11: quick replies (admin-configured canned text, shortcut-triggered in the
 * compose box) and media messages (Phase6Api.sendMediaReply, Phase3ExotelProvider's
 * sendMedia/inbound-media extraction, Message_Media storage — see those files).
 *
 * Quick reply CRUD mirrors Phase 8's Lead_Stages pattern exactly: managing the list is
 * admin configuration (SETTINGS_MANAGE, ADMIN-only), while any authenticated user may
 * list them (used to populate the compose box's shortcut picker).
 */
class Phase11Api {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    this.quickReplies_ = new QuickReplyRepository();
  }

  createQuickReply(input) {
    var actor = this.access_.require(Phase1Permissions.SETTINGS_MANAGE);
    var shortcut = Phase1Validation.requiredString(input.shortcut, 'shortcut');
    if (this.quickReplies_.findOne(function (q) { return q.shortcut === shortcut; })) throw new Phase1Error('CONFLICT', 'A quick reply with this shortcut already exists.');
    var now = Phase1Ids.now();
    var record = { id: Phase1Ids.create('quickreply'), shortcut: shortcut, text: Phase1Validation.requiredString(input.text, 'text'), active: input.active !== false, createdAt: now, updatedAt: now };
    this.quickReplies_.create(record);
    this.audit_.write(actor.id, 'quickReply.created', 'quickReply', record.id, {});
    return record;
  }

  updateQuickReply(id, patch) {
    var actor = this.access_.require(Phase1Permissions.SETTINGS_MANAGE);
    if (!this.quickReplies_.get(id)) throw new Phase1Error('NOT_FOUND', 'Quick reply was not found.');
    var allowed = ['shortcut', 'text', 'active'];
    var safePatch = {};
    Object.keys(patch || {}).forEach(function (key) {
      if (allowed.indexOf(key) === -1) throw new Phase1Error('VALIDATION_ERROR', 'Field cannot be updated: ' + key);
      safePatch[key] = patch[key];
    });
    var record = this.quickReplies_.update(id, safePatch);
    this.audit_.write(actor.id, 'quickReply.updated', 'quickReply', id, {});
    return record;
  }

  listQuickReplies() {
    this.access_.currentUser(); // any authenticated user may see the quick-reply list (used for the compose box)
    return this.quickReplies_.list().filter(function (q) { return q.active !== false; })
      .sort(function (a, b) { return (a.shortcut || '').localeCompare(b.shortcut || ''); });
  }
}

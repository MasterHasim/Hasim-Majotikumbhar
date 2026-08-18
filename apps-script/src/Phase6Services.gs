/**
 * Phase 6 outbound: agent/admin replies to a conversation, as plain text or (Phase 10)
 * an approved template. Reuses AccessControl.requireConversationOperation('reply', ...)
 * — ADMIN globally, AGENT only for conversations assigned to them (matches
 * docs/REQUIREMENTS.md's permission table; SUPERVISOR/SITE_MANAGER are not listed as
 * reply-capable there).
 *
 * The "from" number passed to ExotelProvider is the E.164 phone number (toE164_), not
 * providerNumberId — Phase 4's live webhook testing found Exotel identifies numbers by
 * phone number, not the Meta "Phone Profile" ID captured in Phase 3, and there is no
 * reason to expect the send API to differ. UNVERIFIED pending a live test (real
 * cost/message — deliberately not run without the user present, see memory/DECISIONS.md).
 */
function toE164_(phoneNumber) {
  var raw = String(phoneNumber || '');
  if (raw.indexOf('+') === 0) return raw;
  var digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '0') digits = digits.slice(1);
  if (digits.length === 10) return '+91' + digits;
  return '+' + digits;
}

function extractOutboundProviderMessageId_(response) {
  // UNVERIFIED — Exotel's send-message response shape has not been live-tested.
  // Best-effort guess consistent with the confirmed inbound/webhook `sid` field name.
  if (!response) return null;
  if (response.sid) return response.sid;
  if (response.message_sid) return response.message_sid;
  if (response.id) return response.id;
  var messages = response.whatsapp && response.whatsapp.messages;
  var first = messages && messages[0];
  if (first) return first.sid || first.id || first.message_sid || null;
  return null;
}

class Phase6Api {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    this.numbers_ = new NumberRepository();
    this.customers_ = new CustomerRepository();
    this.conversations_ = new ConversationRepository();
    this.messages_ = new MessageRepository();
    this.templates_ = new TemplateRepository();
    this.messageMedia_ = new MessageMediaRepository();
  }

  sendReply(conversationId, text) {
    text = Phase1Validation.requiredString(text, 'text');
    return this.sendOutbound_(conversationId, 'text', text, function (provider, number, customer) {
      return provider.sendText(toE164_(number.phoneNumber), toE164_(customer.phone), text);
    });
  }

  /** Phase 10: send an approved template with variables substituted into its components. UNVERIFIED — sendTemplate has never been called live, same as sendText. */
  sendTemplateReply(conversationId, templateId, variables) {
    var template = this.templates_.get(templateId);
    if (!template) throw new Phase1Error('NOT_FOUND', 'Template was not found.');
    if (template.status !== 'APPROVED') throw new Phase1Error('VALIDATION_ERROR', 'Only an APPROVED template can be sent.');
    var components = substituteTemplateVariables_(template.components, variables || {});
    var displayText = '[Template: ' + template.name + ']';
    return this.sendOutbound_(conversationId, 'template', displayText, function (provider, number, customer) {
      return provider.sendTemplate(toE164_(number.phoneNumber), toE164_(customer.phone), template.name, template.language, components);
    });
  }

  /** Phase 11: send a media message (image/document/etc). UNVERIFIED — sendMedia has never been called live, same as sendText/sendTemplate. */
  sendMediaReply(conversationId, mediaType, mediaUrl, caption) {
    mediaType = Phase1Validation.requiredString(mediaType, 'mediaType');
    mediaUrl = Phase1Validation.requiredString(mediaUrl, 'mediaUrl');
    var displayText = caption || ('[Media: ' + mediaType + ']');
    var message = this.sendOutbound_(conversationId, 'media', displayText, function (provider, number, customer) {
      return provider.sendMedia(toE164_(number.phoneNumber), toE164_(customer.phone), mediaType, mediaUrl, caption || '');
    });
    this.messageMedia_.create({ id: Phase1Ids.create('media'), messageId: message.id, mediaType: mediaType, mediaUrl: mediaUrl, caption: caption || '' });
    return message;
  }

  /**
   * Uploads a locally-picked file (base64, from the compose box's file input) to a
   * shared Drive folder and returns a public URL, so the agent doesn't have to already
   * have a hosted URL to attach media — see sendMediaReply above for the send itself.
   * Gated on the same 'reply' tier as sendMediaReply/sendReply, scoped to the specific
   * conversation, so this can't be used as an open file-upload endpoint.
   *
   * The returned URL must be fetchable by Exotel with no Google sign-in (WhatsApp's/
   * Exotel's servers, not a browser), so the file is shared "Anyone with the link" —
   * this makes the uploaded media as unlisted-but-public as its Drive link, which is
   * unavoidable for external delivery. UNVERIFIED whether Exotel's sendMedia can
   * actually fetch a drive.google.com URL — same live-test caveat as sendMedia itself
   * (see file header), flag this the same way if delivery fails.
   */
  uploadConversationMedia(conversationId, base64Data, filename, mimeType) {
    var conversation = this.conversations_.get(conversationId);
    if (!conversation) throw new Phase1Error('NOT_FOUND', 'Conversation was not found.');
    var teamId = this.access_.resolveTeamIdForNumber(conversation.numberId);
    this.access_.requireConversationOperation('reply', { numberId: conversation.numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });
    base64Data = Phase1Validation.requiredString(base64Data, 'base64Data');
    filename = Phase1Validation.requiredString(filename, 'filename');
    mimeType = Phase1Validation.requiredString(mimeType, 'mimeType');
    var bytes = Utilities.base64Decode(base64Data);
    var blob = Utilities.newBlob(bytes, mimeType, filename);
    // 2026-08-10: DriveApp.createFile() was assumed covered by the narrower
    // drive.file scope — live-tested and that assumption was wrong (Apps Script
    // required the full https://www.googleapis.com/auth/drive scope for it too).
    // appsscript.json now grants that instead; see the manifest and memory/DECISIONS.md.
    var file = DriveApp.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    // 2026-08-11: export=download served everything as application/octet-stream
    // regardless of the file's real type, so WhatsApp couldn't tell it was an
    // image and delivered it as a generic binary attachment. export=view serves
    // the file inline with its actual Content-Type instead — the standard fix for
    // hotlinking Drive files. Confirmed working for images; unverified for
    // video/audio/document (Drive's inline viewer behaves differently per type) —
    // flag it again if a non-image attachment still arrives wrong.
    return { url: 'https://drive.google.com/uc?export=view&id=' + file.getId(), fileId: file.getId() };
  }

  /**
   * Marks a conversation resolved once an agent feels the query is handled (per
   * explicit user decision, 2026-08-10 — see memory/DECISIONS.md). Reuses the same
   * 'reply' authorization tier as sendReply/sendTemplateReply/sendMediaReply — ADMIN
   * globally, the assigned AGENT only — since "who can act on this conversation" is
   * already exactly that set; no new permission was invented for this.
   *
   * No explicit "reopen" action: a customer's next inbound message on a CLOSED
   * conversation simply starts a new OPEN one (Phase4Api.ingestInboundMessage already
   * only ever reuses a conversation with status: 'OPEN'), so reopening falls out of
   * the existing ingestion logic for free.
   */
  resolveConversation(conversationId) {
    var conversation = this.conversations_.get(conversationId);
    if (!conversation) throw new Phase1Error('NOT_FOUND', 'Conversation was not found.');
    var teamId = this.access_.resolveTeamIdForNumber(conversation.numberId);
    var actor = this.access_.requireConversationOperation('reply', { numberId: conversation.numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });
    var record = this.conversations_.update(conversationId, { status: 'CLOSED' });
    this.audit_.write(actor.id, 'conversation.resolved', 'conversation', conversationId, {});
    return record;
  }

  sendOutbound_(conversationId, messageType, displayText, sendFn) {
    var conversation = this.conversations_.get(conversationId);
    if (!conversation) throw new Phase1Error('NOT_FOUND', 'Conversation was not found.');
    var teamId = this.access_.resolveTeamIdForNumber(conversation.numberId);
    var actor = this.access_.requireConversationOperation('reply', { numberId: conversation.numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });

    var number = this.numbers_.get(conversation.numberId);
    var customer = this.customers_.get(conversation.customerId);
    if (!number || !customer) throw new Phase1Error('NOT_FOUND', 'Number or customer was not found.');

    var providerMessageId = '', status = 'SENT';
    try {
      var response = sendFn(new ExotelProvider(), number, customer);
      providerMessageId = extractOutboundProviderMessageId_(response) || '';
    } catch (sendError) {
      status = 'FAILED';
    }

    var now = Phase1Ids.now();
    var message = {
      id: Phase1Ids.create('message'), conversationId: conversationId, numberId: conversation.numberId, senderUserId: actor.id,
      direction: 'OUTBOUND', messageType: messageType, messageText: displayText, providerMessageId: providerMessageId, status: status, timestamp: now
    };
    this.messages_.create(message);
    // Once the message record itself is saved, the reply has to be reported as a
    // success to the caller — the customer already received it (or the failure was
    // already recorded), and the client's post-send refresh depends on this callback
    // succeeding. Conversation metadata and the audit entry are secondary bookkeeping;
    // if either throws (e.g. lock contention from a concurrent webhook write, since
    // every collection currently shares one script-wide LockService lock), that must
    // not turn an already-successful send into a reported failure — the agent's
    // dashboard would stop auto-refreshing even though the message was actually saved.
    try {
      if (status === 'SENT') this.conversations_.update(conversationId, { needsResponse: false, lastMessageAt: now });
      this.audit_.write(actor.id, status === 'SENT' ? 'message.sent' : 'message.sendFailed', 'message', message.id, { conversationId: conversationId });
    } catch (bookkeepingError) {
      console.error('sendOutbound_: message saved but conversation/audit bookkeeping failed', bookkeepingError);
    }
    return message;
  }
}

function substituteTemplateVariables_(components, variables) {
  // UNVERIFIED — best-effort placeholder substitution ({{1}}, {{2}}, ... by position)
  // matching Meta/WhatsApp template component conventions; not live-tested.
  return (components || []).map(function (component) {
    if (!component || component.type !== 'BODY' || typeof component.text !== 'string') return component;
    var text = component.text.replace(/\{\{(\d+)\}\}/g, function (match, index) {
      var value = variables[index];
      return value !== undefined ? String(value) : match;
    });
    return Object.assign({}, component, { text: text });
  });
}

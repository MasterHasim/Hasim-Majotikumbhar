/**
 * Phase 6 outbound: agent/admin replies to a conversation. Reuses
 * AccessControl.requireConversationOperation('reply', ...) — ADMIN globally, AGENT
 * only for conversations assigned to them (matches docs/REQUIREMENTS.md's permission
 * table; SUPERVISOR/SITE_MANAGER are not listed as reply-capable there).
 *
 * The "from" number passed to ExotelProvider.sendText is the E.164 phone number
 * (toE164_), not providerNumberId — Phase 4's live webhook testing found Exotel
 * identifies numbers by phone number, not the Meta "Phone Profile" ID captured in
 * Phase 3, and there is no reason to expect the send API to differ. UNVERIFIED
 * pending a live test (real cost/message — deliberately not run without the user
 * present, see memory/DECISIONS.md).
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
  }

  sendReply(conversationId, text) {
    var conversation = this.conversations_.get(conversationId);
    if (!conversation) throw new Phase1Error('NOT_FOUND', 'Conversation was not found.');
    var teamId = this.access_.resolveTeamIdForNumber(conversation.numberId);
    var actor = this.access_.requireConversationOperation('reply', { numberId: conversation.numberId, teamId: teamId, assignedUserId: conversation.assignedUserId });
    text = Phase1Validation.requiredString(text, 'text');

    var number = this.numbers_.get(conversation.numberId);
    var customer = this.customers_.get(conversation.customerId);
    if (!number || !customer) throw new Phase1Error('NOT_FOUND', 'Number or customer was not found.');

    var providerMessageId = '', status = 'SENT';
    try {
      var response = new ExotelProvider().sendText(toE164_(number.phoneNumber), toE164_(customer.phone), text);
      providerMessageId = extractOutboundProviderMessageId_(response) || '';
    } catch (sendError) {
      status = 'FAILED';
    }

    var now = Phase1Ids.now();
    var message = {
      id: Phase1Ids.create('message'), conversationId: conversationId, numberId: conversation.numberId, senderUserId: actor.id,
      direction: 'OUTBOUND', messageType: 'text', messageText: text, providerMessageId: providerMessageId, status: status, timestamp: now
    };
    this.messages_.create(message);
    if (status === 'SENT') this.conversations_.update(conversationId, { needsResponse: false, lastMessageAt: now });
    this.audit_.write(actor.id, status === 'SENT' ? 'message.sent' : 'message.sendFailed', 'message', message.id, { conversationId: conversationId });
    return message;
  }
}

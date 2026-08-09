/**
 * Phase 4 ingestion: turns a normalized webhook payload (from
 * ExotelProvider.processWebhook(), src/Phase3ExotelProvider.gs) into Customer/
 * Conversation/Message records. No AccessControl check — a webhook has no Google
 * Workspace identity; it's a system-level operation, audited with actorUserId: null.
 *
 * Round-robin assignment (Phase 7) is invoked here for brand-new conversations, once
 * this method's own lock has been released — Phase7Api.assignConversation acquires
 * its own LockService lock, and nesting two locks from the same execution risks a
 * deadlock, so the call happens strictly after this method's try/finally completes.
 */
/**
 * Confirmed live 2026-08-10: Exotel's webhook `to` field is the actual E.164 phone
 * number (e.g. "+917948502801"), not the providerNumberId (Meta "Phone Profile" ID)
 * captured for each number during Phase 3 registration — that ID isn't what Exotel's
 * webhook uses to identify which number received a message. Numbers are matched by
 * comparing the last 10 digits of phoneNumber against the last 10 digits of the
 * incoming value, which absorbs formatting differences (dashes, leading 0, +91
 * country code) between our stored "079-485-02801" style and Exotel's "+917948502801".
 */
function normalizePhoneTail_(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

class Phase4Api {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.numbers_ = new NumberRepository();
    this.customers_ = new CustomerRepository();
    this.conversations_ = new ConversationRepository();
    this.messages_ = new MessageRepository();
  }

  ingestInboundMessage(normalized) {
    if (!normalized || !normalized.providerMessageId) throw new Phase1Error('VALIDATION_ERROR', 'providerMessageId is required.');
    if (normalized.direction !== 'INBOUND') return this.applyStatusUpdate_(normalized);

    var isNewCustomer = false, isNewConversation = false, conversation, customer, message;
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (this.messages_.findOne(function (m) { return m.providerMessageId === normalized.providerMessageId; })) {
        return { duplicate: true, providerMessageId: normalized.providerMessageId };
      }
      var incomingNumberTail = normalizePhoneTail_(normalized.providerNumberId);
      var number = this.numbers_.findOne(function (n) { return normalizePhoneTail_(n.phoneNumber) === incomingNumberTail; });
      if (!number) throw new Phase1Error('NOT_FOUND', 'No registered number matches: ' + normalized.providerNumberId);

      var now = Phase1Ids.now();
      var incomingCustomerTail = normalizePhoneTail_(normalized.fromPhone);
      customer = this.customers_.findOne(function (c) { return normalizePhoneTail_(c.phone) === incomingCustomerTail; });
      if (!customer) {
        customer = { id: Phase1Ids.create('customer'), phone: normalized.fromPhone, name: normalized.profileName || '', email: '', company: '', source: 'whatsapp', createdAt: now, updatedAt: now };
        this.customers_.create(customer);
        isNewCustomer = true;
      }

      conversation = this.conversations_.findOne(function (c) { return c.customerId === customer.id && c.numberId === number.id && c.status === 'OPEN'; });
      if (!conversation) {
        conversation = { id: Phase1Ids.create('conversation'), customerId: customer.id, numberId: number.id, assignedUserId: '', status: 'OPEN', needsResponse: true, lastMessageAt: normalized.timestamp || now, createdAt: now, updatedAt: now };
        this.conversations_.create(conversation);
        isNewConversation = true;
      }

      message = {
        id: Phase1Ids.create('message'), conversationId: conversation.id, numberId: number.id, senderUserId: '',
        direction: 'INBOUND', messageType: normalized.messageType || 'text', messageText: normalized.text || '',
        providerMessageId: normalized.providerMessageId, status: normalized.status || 'RECEIVED', timestamp: normalized.timestamp || now
      };
      this.messages_.create(message);
      this.conversations_.update(conversation.id, { needsResponse: true, lastMessageAt: message.timestamp });
      this.audit_.write(null, 'message.ingested', 'message', message.id, { conversationId: conversation.id, customerId: customer.id, numberId: number.id });
    } finally {
      lock.releaseLock();
    }

    if (isNewConversation) new Phase7Api().assignConversation(conversation, isNewCustomer);
    return { duplicate: false, messageId: message.id, conversationId: conversation.id, customerId: customer.id };
  }

  applyStatusUpdate_(normalized) {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var message = this.messages_.findOne(function (m) { return m.providerMessageId === normalized.providerMessageId; });
      if (!message) return { statusUpdate: true, applied: false, providerMessageId: normalized.providerMessageId };
      this.messages_.update(message.id, { status: normalized.status });
      this.audit_.write(null, 'message.statusUpdated', 'message', message.id, { status: normalized.status });
      return { statusUpdate: true, applied: true, messageId: message.id, status: normalized.status };
    } finally {
      lock.releaseLock();
    }
  }
}

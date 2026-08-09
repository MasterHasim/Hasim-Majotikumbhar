/**
 * Phase 4 ingestion: turns a normalized webhook payload (from
 * ExotelProvider.processWebhook(), src/Phase3ExotelProvider.gs) into Customer/
 * Conversation/Message records. No AccessControl check — a webhook has no Google
 * Workspace identity; it's a system-level operation, audited with actorUserId: null.
 * Round-robin assignment is explicitly Phase 7's job — conversations are created with
 * assignedUserId: '' here.
 */
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

    var self = this;
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (this.messages_.findOne(function (m) { return m.providerMessageId === normalized.providerMessageId; })) {
        return { duplicate: true, providerMessageId: normalized.providerMessageId };
      }
      var number = this.numbers_.findOne(function (n) { return n.providerNumberId === normalized.providerNumberId; });
      if (!number) throw new Phase1Error('NOT_FOUND', 'No registered number matches providerNumberId: ' + normalized.providerNumberId);

      var now = Phase1Ids.now();
      var customer = this.customers_.findOne(function (c) { return c.phone === normalized.fromPhone; });
      if (!customer) {
        customer = { id: Phase1Ids.create('customer'), phone: normalized.fromPhone, name: '', email: '', company: '', source: 'whatsapp', createdAt: now, updatedAt: now };
        this.customers_.create(customer);
      }

      var conversation = this.conversations_.findOne(function (c) { return c.customerId === customer.id && c.numberId === number.id && c.status === 'OPEN'; });
      if (!conversation) {
        conversation = { id: Phase1Ids.create('conversation'), customerId: customer.id, numberId: number.id, assignedUserId: '', status: 'OPEN', needsResponse: true, lastMessageAt: normalized.timestamp || now, createdAt: now, updatedAt: now };
        this.conversations_.create(conversation);
      }

      var message = {
        id: Phase1Ids.create('message'), conversationId: conversation.id, numberId: number.id, senderUserId: '',
        direction: 'INBOUND', messageType: normalized.messageType || 'text', messageText: normalized.text || '',
        providerMessageId: normalized.providerMessageId, status: normalized.status || 'RECEIVED', timestamp: normalized.timestamp || now
      };
      this.messages_.create(message);
      this.conversations_.update(conversation.id, { needsResponse: true, lastMessageAt: message.timestamp });
      this.audit_.write(null, 'message.ingested', 'message', message.id, { conversationId: conversation.id, customerId: customer.id, numberId: number.id });

      return { duplicate: false, messageId: message.id, conversationId: conversation.id, customerId: customer.id };
    } finally {
      lock.releaseLock();
    }
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

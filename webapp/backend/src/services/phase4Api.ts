/**
 * Direct port of apps-script/src/Phase4Services.gs's Phase4Api — turns a normalized
 * webhook payload into Customer/Conversation/Message records. No AccessControl check
 * — a webhook has no signed-in identity; it's a system-level operation, audited with
 * actorUserId: null, same as the source.
 *
 * Round-robin auto-assignment (Phase7Api.assignConversation) runs for a brand-new
 * conversation after the write completes, same ordering the source used relative to
 * its own LockService lock (this backend has no equivalent lock to wait for release
 * of — see src/lib/repository.ts's note on that trade-off — the ordering is kept
 * anyway since it's the same logical sequence: message recorded first, then assigned).
 */
import { ApiError } from '../types';
import { Ids } from '../domain/phase1';
import type { Conversation, Customer, Message, MessageMedia, WhatsAppNumber } from '../domain/types';
import { Repository } from '../lib/repository';
import { AuditLogService } from '../lib/auditLog';
import { AppDb } from '../lib/appDb';
import { normalizePhoneTail, type NormalizedWebhookMessage } from './exotelProvider';
import { Phase7Api } from './phase7Api';
import { Phase22Api } from './phase22Api';
import { enqueueCustomerSync, type CustomerSyncQueue } from './zohoCrm';
import { decideInboundChatbotRouting, type ChatbotInboundDecision } from './chatbotRouting';
import { ChatbotIntegrationApi } from './chatbotIntegrationApi';

export interface IngestResult {
  duplicate?: boolean;
  statusUpdate?: boolean;
  applied?: boolean;
  providerMessageId?: string | null;
  messageId?: string;
  conversationId?: string;
  customerId?: string;
  status?: string | null;
  chatbot?: ChatbotInboundDecision;
}

export class Phase4Api {
  private audit: AuditLogService;
  private numbers: Repository<WhatsAppNumber>;
  private customers: Repository<Customer>;
  private conversations: Repository<Conversation>;
  private messages: Repository<Message>;
  private messageMedia: Repository<MessageMedia>;

  constructor(private db: AppDb, private customerSyncQueue?: CustomerSyncQueue) {
    this.audit = new AuditLogService(db);
    this.numbers = new Repository<WhatsAppNumber>(db, 'numbers');
    this.customers = new Repository<Customer>(db, 'customers');
    this.conversations = new Repository<Conversation>(db, 'webapp_conversations');
    this.messages = new Repository<Message>(db, 'webapp_messages');
    this.messageMedia = new Repository<MessageMedia>(db, 'messageMedia');
  }

  async ingestInboundMessage(normalized: NormalizedWebhookMessage): Promise<IngestResult> {
    if (!normalized?.providerMessageId) throw new ApiError(400, 'VALIDATION_ERROR', 'providerMessageId is required.');
    if (normalized.direction !== 'INBOUND') return this.applyStatusUpdate(normalized);

    if (await this.messages.findOne((m) => m.providerMessageId === normalized.providerMessageId)) {
      return { duplicate: true, providerMessageId: normalized.providerMessageId };
    }
    const incomingNumberTail = normalizePhoneTail(normalized.providerNumberId);
    const number = await this.numbers.findOne((n) => normalizePhoneTail(n.phoneNumber) === incomingNumberTail);
    if (!number) throw new ApiError(404, 'NOT_FOUND', `No registered number matches: ${normalized.providerNumberId}`);

    const now = Ids.now();
    const incomingCustomerTail = normalizePhoneTail(normalized.fromPhone);
    let customer = await this.customers.findOne((c) => normalizePhoneTail(c.phone) === incomingCustomerTail);
    let isNewCustomer = false;
    if (!customer) {
      customer = { id: Ids.create('customer'), phone: normalized.fromPhone ?? '', name: normalized.profileName || '', email: '', company: '', source: 'whatsapp', createdAt: now, updatedAt: now };
      await this.customers.create(customer);
      isNewCustomer = true;
      await enqueueCustomerSync(this.customerSyncQueue, customer.id);
    }

    let conversation = await this.conversations.findOne((c) => c.customerId === customer!.id && c.numberId === number.id && c.status === 'OPEN');
    let isNewConversation = false;
    if (!conversation) {
      conversation = { id: Ids.create('conversation'), customerId: customer.id, numberId: number.id, assignedUserId: '', status: 'OPEN', needsResponse: true, lastMessageAt: normalized.timestamp || now, lastCustomerMessageAt: normalized.timestamp || now, createdAt: now, updatedAt: now };
      await this.conversations.create(conversation);
      isNewConversation = true;
    }

    const message: Message = {
      id: Ids.create('message'), conversationId: conversation.id, numberId: number.id, senderUserId: '',
      direction: 'INBOUND', messageType: normalized.messageType || 'text', messageText: normalized.text || '',
      providerMessageId: normalized.providerMessageId, status: (normalized.status as Message['status']) || 'RECEIVED', timestamp: normalized.timestamp || now,
      ...(normalized.referral ? { referral: normalized.referral } : {}),
    };
    await this.messages.create(message);
    if (normalized.mediaUrl) {
      await this.messageMedia.create({ id: Ids.create('media'), messageId: message.id, mediaType: normalized.messageType || 'image', mediaUrl: normalized.mediaUrl, caption: normalized.text || '' });
    }
    await this.conversations.update(conversation.id, { needsResponse: true, lastMessageAt: message.timestamp, lastCustomerMessageAt: message.timestamp });
    await this.audit.write(null, 'message.ingested', 'message', message.id, { conversationId: conversation.id, customerId: customer.id, numberId: number.id });

    if (isNewConversation) {
      // System-level operation, same as the rest of this method — the placeholder
      // identity is never actually checked (assignConversation makes no
      // AccessControl calls, same as apps-script/src/Phase7Services.gs's version).
      await new Phase7Api(this.db, 'system@internal').assignConversation(conversation, isNewCustomer);
      // Added 2026-08-24, per an explicit product decision: every new WhatsApp conversation
      // should fall under a real Lead. Best-effort/non-blocking internally (see
      // Phase22Api.autoCreateLeadFromConversation) — never allowed to fail this request.
      await new Phase22Api(this.db, 'system@internal').autoCreateLeadFromConversation(customer.name, customer.phone, number.id);
    }

    const chatbot = decideInboundChatbotRouting(number, conversation);
    if (chatbot.action !== 'disabled') {
      await this.audit.write(null, 'chatbot.inboundRouted', 'conversation', conversation.id, { mode: chatbot.mode, action: chatbot.action, reason: chatbot.reason });
    }
    if (chatbot.action === 'reply' || chatbot.action === 'shadow') {
      // Added 2026-08-31 — this is the provider adapter chatbotRouting.ts's original comment
      // flagged as missing: actually deliver the message to the chatbot's own webhook, not just
      // decide and log that it should be. Best-effort/non-blocking internally (see
      // ChatbotIntegrationApi.notifyInboundMessage) — never allowed to fail this request.
      await new ChatbotIntegrationApi(this.db, {}).notifyInboundMessage(number, conversation, message, customer, chatbot, isNewConversation, isNewCustomer);
    }
    return { duplicate: false, messageId: message.id, conversationId: conversation.id, customerId: customer.id, chatbot };
  }

  private async applyStatusUpdate(normalized: NormalizedWebhookMessage): Promise<IngestResult> {
    const message = await this.messages.findOne((m) => m.providerMessageId === normalized.providerMessageId);
    if (!message) return { statusUpdate: true, applied: false, providerMessageId: normalized.providerMessageId };
    await this.messages.update(message.id, { status: normalized.status as Message['status'] });
    await this.audit.write(null, 'message.statusUpdated', 'message', message.id, { status: normalized.status });
    return { statusUpdate: true, applied: true, messageId: message.id, status: normalized.status };
  }
}

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
import { FirebaseDb } from '../lib/firebaseAdmin';
import { normalizePhoneTail, type NormalizedWebhookMessage } from './exotelProvider';
import { Phase7Api } from './phase7Api';

export interface IngestResult {
  duplicate?: boolean;
  statusUpdate?: boolean;
  applied?: boolean;
  providerMessageId?: string | null;
  messageId?: string;
  conversationId?: string;
  customerId?: string;
  status?: string | null;
}

export class Phase4Api {
  private audit: AuditLogService;
  private numbers: Repository<WhatsAppNumber>;
  private customers: Repository<Customer>;
  private conversations: Repository<Conversation>;
  private messages: Repository<Message>;
  private messageMedia: Repository<MessageMedia>;

  constructor(private db: FirebaseDb) {
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
    }

    let conversation = await this.conversations.findOne((c) => c.customerId === customer!.id && c.numberId === number.id && c.status === 'OPEN');
    let isNewConversation = false;
    if (!conversation) {
      conversation = { id: Ids.create('conversation'), customerId: customer.id, numberId: number.id, assignedUserId: '', status: 'OPEN', needsResponse: true, lastMessageAt: normalized.timestamp || now, createdAt: now, updatedAt: now };
      await this.conversations.create(conversation);
      isNewConversation = true;
    }

    const message: Message = {
      id: Ids.create('message'), conversationId: conversation.id, numberId: number.id, senderUserId: '',
      direction: 'INBOUND', messageType: normalized.messageType || 'text', messageText: normalized.text || '',
      providerMessageId: normalized.providerMessageId, status: (normalized.status as Message['status']) || 'RECEIVED', timestamp: normalized.timestamp || now,
    };
    await this.messages.create(message);
    if (normalized.mediaUrl) {
      await this.messageMedia.create({ id: Ids.create('media'), messageId: message.id, mediaType: normalized.messageType || 'image', mediaUrl: normalized.mediaUrl, caption: normalized.text || '' });
    }
    await this.conversations.update(conversation.id, { needsResponse: true, lastMessageAt: message.timestamp });
    await this.audit.write(null, 'message.ingested', 'message', message.id, { conversationId: conversation.id, customerId: customer.id, numberId: number.id });

    if (isNewConversation) {
      // System-level operation, same as the rest of this method — the placeholder
      // identity is never actually checked (assignConversation makes no
      // AccessControl calls, same as apps-script/src/Phase7Services.gs's version).
      await new Phase7Api(this.db, 'system@internal').assignConversation(conversation, isNewCustomer);
    }

    return { duplicate: false, messageId: message.id, conversationId: conversation.id, customerId: customer.id };
  }

  private async applyStatusUpdate(normalized: NormalizedWebhookMessage): Promise<IngestResult> {
    const message = await this.messages.findOne((m) => m.providerMessageId === normalized.providerMessageId);
    if (!message) return { statusUpdate: true, applied: false, providerMessageId: normalized.providerMessageId };
    await this.messages.update(message.id, { status: normalized.status as Message['status'] });
    await this.audit.write(null, 'message.statusUpdated', 'message', message.id, { status: normalized.status });
    return { statusUpdate: true, applied: true, messageId: message.id, status: normalized.status };
  }
}

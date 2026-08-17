/**
 * Direct port of apps-script/src/Phase4Services.gs's Phase4Api — turns a normalized
 * webhook payload into Customer/Conversation/Message records. No AccessControl check
 * — a webhook has no signed-in identity; it's a system-level operation, audited with
 * actorUserId: null, same as the source.
 *
 * Round-robin auto-assignment (Phase7Api.assignConversation in the source) is not
 * wired in yet — that's CRM core (a separate migration phase, see PROGRESS.md), so a
 * brand-new conversation is left unassigned here for now, same as the Apps Script
 * build's own state before its Phase 7 existed.
 */
import { ApiError } from '../types';
import { Ids } from '../domain/phase1';
import type { Conversation, Customer, Message, WhatsAppNumber } from '../domain/types';
import { Repository } from '../lib/repository';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { normalizePhoneTail, type NormalizedWebhookMessage } from './exotelProvider';

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

  constructor(private db: FirebaseDb) {
    this.audit = new AuditLogService(db);
    this.numbers = new Repository<WhatsAppNumber>(db, 'numbers');
    this.customers = new Repository<Customer>(db, 'customers');
    this.conversations = new Repository<Conversation>(db, 'conversations');
    this.messages = new Repository<Message>(db, 'messages');
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
    if (!customer) {
      customer = { id: Ids.create('customer'), phone: normalized.fromPhone ?? '', name: normalized.profileName || '', email: '', company: '', source: 'whatsapp', createdAt: now, updatedAt: now };
      await this.customers.create(customer);
    }

    let conversation = await this.conversations.findOne((c) => c.customerId === customer!.id && c.numberId === number.id && c.status === 'OPEN');
    if (!conversation) {
      conversation = { id: Ids.create('conversation'), customerId: customer.id, numberId: number.id, assignedUserId: '', status: 'OPEN', needsResponse: true, lastMessageAt: normalized.timestamp || now, createdAt: now, updatedAt: now };
      await this.conversations.create(conversation);
    }

    const message: Message = {
      id: Ids.create('message'), conversationId: conversation.id, numberId: number.id, senderUserId: '',
      direction: 'INBOUND', messageType: normalized.messageType || 'text', messageText: normalized.text || '',
      providerMessageId: normalized.providerMessageId, status: (normalized.status as Message['status']) || 'RECEIVED', timestamp: normalized.timestamp || now,
    };
    await this.messages.create(message);
    await this.conversations.update(conversation.id, { needsResponse: true, lastMessageAt: message.timestamp });
    await this.audit.write(null, 'message.ingested', 'message', message.id, { conversationId: conversation.id, customerId: customer.id, numberId: number.id });

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

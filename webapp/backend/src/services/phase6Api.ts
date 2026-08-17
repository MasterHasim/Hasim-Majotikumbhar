/**
 * Direct port of apps-script/src/Phase6Services.gs's Phase6Api — agent/admin replies
 * and conversation resolution. sendTemplateReply/sendMediaReply/uploadConversationMedia
 * are deferred to the templates/media migration phase (see PROGRESS.md) since they
 * depend on Templates existing and on a Drive-equivalent file host (Cloudflare R2) not
 * set up yet — plain text sendReply and resolveConversation don't need either.
 *
 * The bookkeeping-isolation fix from the Apps Script build (2026-08-13 — a secondary
 * conversation-metadata/audit-log failure must not turn an already-successful send
 * into a reported failure) is carried over here too, same reasoning: this backend
 * doesn't share Apps Script's single global lock, but a transient Firebase write
 * hiccup on the secondary write is exactly as possible here, and the fix costs nothing.
 */
import { ApiError } from '../types';
import { Ids, Validation } from '../domain/phase1';
import type { Conversation, Customer, Message, WhatsAppNumber } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';
import { ExotelProvider, requireExotelConfig, type ExotelConfig } from './exotelProvider';

/** Same E.164 normalization as apps-script/src/Phase6Services.gs's toE164_. */
export function toE164(phoneNumber: string): string {
  const raw = String(phoneNumber || '');
  if (raw.startsWith('+')) return raw;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '0') digits = digits.slice(1);
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

function extractOutboundProviderMessageId(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as Record<string, unknown>;
  if (typeof r.sid === 'string') return r.sid;
  if (typeof r.message_sid === 'string') return r.message_sid;
  if (typeof r.id === 'string') return r.id;
  const messages = (r.whatsapp as Record<string, unknown> | undefined)?.messages as Array<Record<string, unknown>> | undefined;
  const first = messages?.[0];
  if (first) return (first.sid as string) || (first.id as string) || (first.message_sid as string) || null;
  return null;
}

export class Phase6Api {
  readonly access: AccessControl;
  private audit: AuditLogService;
  private numbers: Repository<WhatsAppNumber>;
  private customers: Repository<Customer>;
  private conversations: Repository<Conversation>;
  private messages: Repository<Message>;
  private exotelConfig: ExotelConfig;

  constructor(db: FirebaseDb, identityEmail: string, env: { EXOTEL_API_KEY?: string; EXOTEL_API_TOKEN?: string; EXOTEL_ACCOUNT_SID?: string; EXOTEL_SUBDOMAIN?: string }) {
    const repos = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(repos, this.audit, identityEmail);
    this.numbers = new Repository<WhatsAppNumber>(db, 'numbers');
    this.customers = new Repository<Customer>(db, 'customers');
    this.conversations = new Repository<Conversation>(db, 'conversations');
    this.messages = new Repository<Message>(db, 'messages');
    this.exotelConfig = requireExotelConfig(env);
  }

  async sendReply(conversationId: string, text: string): Promise<Message> {
    const validText = Validation.requiredString(text, 'text');
    return this.sendOutbound(conversationId, 'text', validText, (provider, number, customer) => provider.sendText(toE164(number.phoneNumber), toE164(customer.phone), validText));
  }

  async resolveConversation(conversationId: string): Promise<Conversation> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    const actor = await this.access.requireConversationOperation('reply', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });
    const record = await this.conversations.update(conversationId, { status: 'CLOSED' });
    await this.audit.write(actor.id, 'conversation.resolved', 'conversation', conversationId, {});
    return record;
  }

  private async sendOutbound(
    conversationId: string,
    messageType: string,
    displayText: string,
    sendFn: (provider: ExotelProvider, number: WhatsAppNumber, customer: Customer) => Promise<unknown>
  ): Promise<Message> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    const actor = await this.access.requireConversationOperation('reply', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });

    const number = await this.numbers.get(conversation.numberId);
    const customer = await this.customers.get(conversation.customerId);
    if (!number || !customer) throw new ApiError(404, 'NOT_FOUND', 'Number or customer was not found.');

    let providerMessageId = '';
    let status: Message['status'] = 'SENT';
    try {
      const response = await sendFn(new ExotelProvider(this.exotelConfig), number, customer);
      providerMessageId = extractOutboundProviderMessageId(response) || '';
    } catch {
      status = 'FAILED';
    }

    const now = Ids.now();
    const message: Message = {
      id: Ids.create('message'), conversationId, numberId: conversation.numberId, senderUserId: actor.id,
      direction: 'OUTBOUND', messageType, messageText: displayText, providerMessageId, status, timestamp: now,
    };
    await this.messages.create(message);

    try {
      if (status === 'SENT') await this.conversations.update(conversationId, { needsResponse: false, lastMessageAt: now });
      await this.audit.write(actor.id, status === 'SENT' ? 'message.sent' : 'message.sendFailed', 'message', message.id, { conversationId });
    } catch (bookkeepingError) {
      console.error('sendOutbound: message saved but conversation/audit bookkeeping failed', bookkeepingError);
    }
    return message;
  }
}

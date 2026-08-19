/**
 * Direct port of apps-script/src/Phase6Services.gs's Phase6Api — agent/admin replies
 * and conversation resolution, now including sendTemplateReply (Phase 10),
 * sendMediaReply (Phase 11, URL-based), and uploadConversationMedia (Phase 11,
 * R2-backed — the free-tier equivalent of the source's Drive-backed upload; the
 * bucket binding is only required by this one method, so it's optional on the
 * constructor the same way Phase22Api's Voice env is).
 *
 * The bookkeeping-isolation fix from the Apps Script build (2026-08-13 — a secondary
 * conversation-metadata/audit-log failure must not turn an already-successful send
 * into a reported failure) is carried over here too, same reasoning: this backend
 * doesn't share Apps Script's single global lock, but a transient Firebase write
 * hiccup on the secondary write is exactly as possible here, and the fix costs nothing.
 */
import { ApiError } from '../types';
import { Ids, Validation } from '../domain/phase1';
import type { Conversation, Customer, Message, MessageMedia, Template, WhatsAppNumber } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';
import { ExotelProvider, requireExotelConfig, type ExotelConfig } from './exotelProvider';

/** UNVERIFIED — best-effort placeholder substitution ({{1}}, {{2}}, ...) matching Meta/WhatsApp template component conventions, same flag apps-script/src/Phase6Services.gs's substituteTemplateVariables_ carries. */
function substituteTemplateVariables(components: unknown[], variables: Record<string, unknown>): unknown[] {
  return (components || []).map((component) => {
    const c = component as { type?: string; text?: string } | null;
    if (!c || c.type !== 'BODY' || typeof c.text !== 'string') return component;
    const text = c.text.replace(/\{\{(\d+)\}\}/g, (match, index) => {
      const value = variables[index];
      return value !== undefined ? String(value) : match;
    });
    return { ...c, text };
  });
}

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
  private templates: Repository<Template>;
  private messageMedia: Repository<MessageMedia>;
  private exotelConfig: ExotelConfig;
  private mediaBucket?: R2Bucket;

  constructor(db: FirebaseDb, identityEmail: string, env: { EXOTEL_API_KEY?: string; EXOTEL_API_TOKEN?: string; EXOTEL_ACCOUNT_SID?: string; EXOTEL_SUBDOMAIN?: string; MEDIA_BUCKET?: R2Bucket }) {
    const repos = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(repos, this.audit, identityEmail);
    this.numbers = new Repository<WhatsAppNumber>(db, 'numbers');
    this.customers = new Repository<Customer>(db, 'customers');
    this.conversations = new Repository<Conversation>(db, 'conversations');
    this.messages = new Repository<Message>(db, 'messages');
    this.templates = new Repository<Template>(db, 'templates');
    this.messageMedia = new Repository<MessageMedia>(db, 'messageMedia');
    this.exotelConfig = requireExotelConfig(env);
    this.mediaBucket = env.MEDIA_BUCKET;
  }

  async sendReply(conversationId: string, text: string): Promise<Message> {
    const validText = Validation.requiredString(text, 'text');
    return this.sendOutbound(conversationId, 'text', validText, (provider, number, customer) => provider.sendText(toE164(number.phoneNumber), toE164(customer.phone), validText));
  }

  /** Send an approved template with variables substituted into its components. UNVERIFIED — sendTemplate has never been called live, same as sendText. */
  async sendTemplateReply(conversationId: string, templateId: string, variables: Record<string, unknown>): Promise<Message> {
    const template = await this.templates.get(templateId);
    if (!template) throw new ApiError(404, 'NOT_FOUND', 'Template was not found.');
    if (template.status !== 'APPROVED') throw new ApiError(400, 'VALIDATION_ERROR', 'Only an APPROVED template can be sent.');
    const components = substituteTemplateVariables(template.components, variables || {});
    const displayText = `[Template: ${template.name}]`;
    return this.sendOutbound(conversationId, 'template', displayText, (provider, number, customer) => provider.sendTemplate(toE164(number.phoneNumber), toE164(customer.phone), template.name, template.language, components));
  }

  /** Send a media message (image/document/etc). UNVERIFIED — sendMedia has never been called live, same as sendText/sendTemplate. Expects an already-hosted mediaUrl (see routes/media.ts for the R2-backed upload that produces one). */
  async sendMediaReply(conversationId: string, mediaType: string, mediaUrl: string, caption: string): Promise<Message> {
    const validMediaType = Validation.requiredString(mediaType, 'mediaType');
    const validMediaUrl = Validation.requiredString(mediaUrl, 'mediaUrl');
    const displayText = caption || `[Media: ${validMediaType}]`;
    const message = await this.sendOutbound(conversationId, 'media', displayText, (provider, number, customer) => provider.sendMedia(toE164(number.phoneNumber), toE164(customer.phone), validMediaType, validMediaUrl, caption || ''));
    await this.messageMedia.create({ id: Ids.create('media'), messageId: message.id, mediaType: validMediaType, mediaUrl: validMediaUrl, caption: caption || '' });
    return message;
  }

  /**
   * Uploads a locally-picked file (base64, from the compose box's file input) to R2 and
   * returns a key the caller turns into a public URL (routes/media.ts serves it back with
   * the real Content-Type, same "don't let the recipient see a generic binary blob" fix
   * the source's Drive-based upload needed). Gated on the same 'reply' tier as
   * sendMediaReply/sendReply, scoped to the specific conversation, so this can't be used
   * as an open file-upload endpoint.
   */
  async uploadConversationMedia(conversationId: string, base64Data: string, filename: string, mimeType: string): Promise<{ key: string }> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    await this.access.requireConversationOperation('reply', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });
    const validBase64 = Validation.requiredString(base64Data, 'base64Data');
    const validFilename = Validation.requiredString(filename, 'filename');
    const validMimeType = Validation.requiredString(mimeType, 'mimeType');
    if (!this.mediaBucket) throw new ApiError(500, 'CONFIGURATION_ERROR', 'Media storage is not configured.');

    const bytes = Uint8Array.from(atob(validBase64), (c) => c.charCodeAt(0));
    const safeName = validFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${Ids.create('media')}-${safeName}`;
    await this.mediaBucket.put(key, bytes, { httpMetadata: { contentType: validMimeType } });
    return { key };
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

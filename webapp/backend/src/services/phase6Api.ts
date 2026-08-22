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
import { Ids, Permissions, Roles, Validation } from '../domain/phase1';
import { Phase22Validation } from '../domain/phase22';
import type { Conversation, Customer, Message, MessageMedia, Template, WhatsAppNumber } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';
import { ExotelProvider, requireExotelConfig, type ExotelConfig } from './exotelProvider';

/**
 * Builds the "components" array Exotel's WhatsApp template-send endpoint actually expects —
 * confirmed 2026-08-22 against developer.exotel.com/docs/whatsapp-api/api-reference/templates
 * after a real template send silently failed to deliver. Each component with {{n}} placeholders
 * needs a lowercase "type" and a positional "parameters" array of {type:'text', text}; sending
 * the previous shape (uppercase "BODY", the placeholders replaced directly into "text") is what
 * this replaced — that was a reasoned-but-unverified guess, never checked against the real docs.
 * Exported — Phase1Api's new-user WhatsApp notification reuses this exact builder.
 */
export function buildTemplateSendComponents(components: unknown[], variables: Record<string, unknown>): { type: string; parameters: { type: 'text'; text: string }[] }[] {
  const result: { type: string; parameters: { type: 'text'; text: string }[] }[] = [];
  for (const component of components || []) {
    const c = component as { type?: string; text?: string } | null;
    if (!c || typeof c.text !== 'string') continue;
    const placeholders = [...c.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]!);
    if (placeholders.length === 0) continue;
    result.push({
      type: (c.type || 'BODY').toLowerCase(),
      parameters: placeholders.map((index) => ({ type: 'text' as const, text: variables[index] !== undefined ? String(variables[index]) : '' })),
    });
  }
  return result;
}

/** Human-readable rendering of a template's BODY text with {{n}} placeholders filled in — used
 * as the chat display text (messageText) so the Inbox shows what the customer actually received
 * instead of a bracketed "[Template: name]" placeholder. Independent from
 * buildTemplateSendComponents, which builds the different shape the send API itself needs. */
export function renderTemplateDisplayText(components: unknown[], variables: Record<string, unknown>): string {
  const body = (components || []).find((c) => {
    const comp = c as { type?: string } | null;
    return !!comp && (comp.type || '').toUpperCase() === 'BODY';
  }) as { text?: string } | undefined;
  if (!body || typeof body.text !== 'string') return '';
  return body.text.replace(/\{\{(\d+)\}\}/g, (match, index) => {
    const value = variables[index];
    return value !== undefined && value !== '' ? String(value) : match;
  });
}

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * WhatsApp's 24-hour customer service window: free-form (text/media) messages are only
 * deliverable within 24h of the customer's own last inbound message — outside it, Meta rejects
 * anything but an approved template. Deliberately does NOT fall back to lastMessageAt: that field
 * is also stamped at conversation *creation* (e.g. startWhatsAppFromLead, or any future ad-hoc
 * "new chat" flow), so a brand-new conversation with zero real customer messages would otherwise
 * look "fresh" and wrongly allow a free-text first message — exactly the send WhatsApp actually
 * rejects. A conversation with no lastCustomerMessageAt has, as far as this app knows, never had
 * an inbound message; see backfillCustomerServiceWindow for the one-time migration that populates
 * it on conversations that predate this field but do have real inbound history.
 */
export function isWithinCustomerServiceWindow(conversation: Conversation): boolean {
  if (!conversation.lastCustomerMessageAt) return false;
  const anchorMs = new Date(conversation.lastCustomerMessageAt).getTime();
  if (Number.isNaN(anchorMs)) return false;
  return Date.now() - anchorMs < CUSTOMER_SERVICE_WINDOW_MS;
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

/**
 * Real bug, confirmed live 2026-08-23: none of the shapes this checked ever matched a real send
 * response, so providerMessageId was empty on every single outbound message ever sent — which
 * meant the (now-fixed) dlr status-callback handler could never find the message to update,
 * silently no-op'ing forever. The real response wraps everything under "response.whatsapp", and
 * each message entry's id sits under "data.sid", not directly on the entry — same "response"
 * envelope Phase10Api's syncTemplatesFromProvider already confirmed live for the templates
 * endpoint. Real payload seen: {"response":{"whatsapp":{"messages":[{"data":{"sid":"..."}}]}}}.
 */
function extractOutboundProviderMessageId(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as Record<string, unknown>;
  if (typeof r.sid === 'string') return r.sid;
  if (typeof r.message_sid === 'string') return r.message_sid;
  if (typeof r.id === 'string') return r.id;
  const wrappedMessages = ((r.response as Record<string, unknown> | undefined)?.whatsapp as Record<string, unknown> | undefined)?.messages as Array<Record<string, unknown>> | undefined;
  const wrappedData = wrappedMessages?.[0]?.data as Record<string, unknown> | undefined;
  if (wrappedData && typeof wrappedData.sid === 'string') return wrappedData.sid;
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
    this.conversations = new Repository<Conversation>(db, 'webapp_conversations');
    this.messages = new Repository<Message>(db, 'webapp_messages');
    this.templates = new Repository<Template>(db, 'templates');
    this.messageMedia = new Repository<MessageMedia>(db, 'messageMedia');
    this.exotelConfig = requireExotelConfig(env);
    this.mediaBucket = env.MEDIA_BUCKET;
  }

  async sendReply(conversationId: string, text: string): Promise<Message> {
    const validText = Validation.requiredString(text, 'text');
    return this.sendOutbound(conversationId, 'text', validText, true, (provider, number, customer) => provider.sendText(toE164(number.phoneNumber), toE164(customer.phone), validText));
  }

  /** Send an approved template with variables substituted into its components. UNVERIFIED — sendTemplate has never been called live, same as sendText. */
  async sendTemplateReply(conversationId: string, templateId: string, variables: Record<string, unknown>): Promise<Message> {
    const template = await this.templates.get(templateId);
    if (!template) throw new ApiError(404, 'NOT_FOUND', 'Template was not found.');
    if (template.status !== 'APPROVED') throw new ApiError(400, 'VALIDATION_ERROR', 'Only an APPROVED template can be sent.');
    const components = buildTemplateSendComponents(template.components, variables || {});
    const displayText = renderTemplateDisplayText(template.components, variables || {}) || `[Template: ${template.name}]`;
    return this.sendOutbound(conversationId, 'template', displayText, false, (provider, number, customer) => provider.sendTemplate(toE164(number.phoneNumber), toE164(customer.phone), template.name, template.language, components), template.name);
  }

  /** Send a media message (image/document/etc). UNVERIFIED — sendMedia has never been called live, same as sendText/sendTemplate. Expects an already-hosted mediaUrl (see routes/media.ts for the R2-backed upload that produces one). */
  async sendMediaReply(conversationId: string, mediaType: string, mediaUrl: string, caption: string): Promise<Message> {
    const validMediaType = Validation.requiredString(mediaType, 'mediaType');
    const validMediaUrl = Validation.requiredString(mediaUrl, 'mediaUrl');
    const displayText = caption || `[Media: ${validMediaType}]`;
    const message = await this.sendOutbound(conversationId, 'media', displayText, true, (provider, number, customer) => provider.sendMedia(toE164(number.phoneNumber), toE164(customer.phone), validMediaType, validMediaUrl, caption || ''));
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

  /**
   * Ad-hoc "message/call a number not already in the CRM" — an agent picks a WhatsApp number
   * they have access to and a raw phone number, and gets a Customer + open Conversation to work
   * from, same shape startWhatsAppFromLead already returns for the Lead-initiated path (reuses
   * the normal Inbox/ChatPane/24h-window/template machinery entirely rather than a parallel
   * "compose new" flow). A conversation created this way has no lastCustomerMessageAt — it's
   * genuinely never had an inbound message — so the first send is correctly forced through an
   * approved template by the same 24h-window check sendReply already enforces.
   */
  async startNewConversation(numberId: string, phone: string, name?: string): Promise<{ customerId: string; conversationId: string; numberId: string }> {
    const actor = await this.access.currentUser();
    const number = await this.numbers.get(numberId);
    if (!number) throw new ApiError(404, 'NOT_FOUND', 'WhatsApp number was not found.');
    if (!(await this.access.hasRole(actor, Roles.ADMIN)) && !(await this.access.hasGrantedNumber(actor.id, numberId))) {
      throw new ApiError(403, 'FORBIDDEN', `You do not have access to the ${number.displayName} WhatsApp number.`);
    }
    const validPhone = toE164(Phase22Validation.phone(phone));
    const now = Ids.now();
    let customer = await this.customers.findOne((c) => toE164(c.phone) === validPhone);
    if (!customer) {
      customer = { id: Ids.create('customer'), phone: validPhone, name: name?.trim() || '', email: '', company: '', source: 'manual', createdAt: now, updatedAt: now };
      await this.customers.create(customer);
    }
    let conversation = await this.conversations.findOne((c) => c.customerId === customer!.id && c.numberId === numberId && c.status === 'OPEN');
    if (!conversation) {
      conversation = { id: Ids.create('conversation'), customerId: customer.id, numberId, assignedUserId: actor.id, status: 'OPEN', needsResponse: false, lastMessageAt: now, createdAt: now, updatedAt: now };
      await this.conversations.create(conversation);
      await this.audit.write(actor.id, 'conversation.startedManually', 'conversation', conversation.id, { phone: validPhone });
    }
    return { customerId: customer.id, conversationId: conversation.id, numberId };
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

  /**
   * One-time migration for conversations that predate lastCustomerMessageAt (see that field's
   * comment in domain/types.ts) — backfills it from the real inbound message history so a
   * genuinely-active old conversation doesn't suddenly look "outside the window" the moment this
   * feature ships. Safe to re-run: only touches conversations that don't already have the field
   * set, and does nothing to a conversation with no inbound message at all (correctly leaves it
   * requiring a template).
   */
  async backfillCustomerServiceWindow(): Promise<{ scanned: number; updated: number }> {
    await this.access.require(Permissions.SETTINGS_MANAGE);
    const [conversations, messages] = await Promise.all([this.conversations.list(), this.messages.list()]);
    const lastInboundByConversation = new Map<string, string>();
    for (const message of messages) {
      if (message.direction !== 'INBOUND') continue;
      const current = lastInboundByConversation.get(message.conversationId);
      if (!current || message.timestamp > current) lastInboundByConversation.set(message.conversationId, message.timestamp);
    }
    let updated = 0;
    for (const conversation of conversations) {
      if (conversation.lastCustomerMessageAt) continue;
      const lastInbound = lastInboundByConversation.get(conversation.id);
      if (!lastInbound) continue;
      // replace(), not update() — the record is already in hand from the list() above, so this
      // is one PUT instead of update()'s GET-then-PUT. With potentially dozens of conversations
      // to backfill in one invocation, halving the per-row cost keeps this comfortably under
      // Cloudflare's free-tier per-invocation subrequest cap (hit this exact wall once already
      // this session — see PROGRESS.md's subrequest-limit note).
      await this.conversations.replace(conversation.id, { ...conversation, lastCustomerMessageAt: lastInbound, updatedAt: Ids.now() });
      updated++;
    }
    return { scanned: conversations.length, updated };
  }

  private async sendOutbound(
    conversationId: string,
    messageType: string,
    displayText: string,
    requiresWindow: boolean,
    sendFn: (provider: ExotelProvider, number: WhatsAppNumber, customer: Customer) => Promise<unknown>,
    templateName?: string
  ): Promise<Message> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found.');
    const teamId = await this.access.resolveTeamIdForNumber(conversation.numberId);
    const actor = await this.access.requireConversationOperation('reply', { numberId: conversation.numberId, teamId, assignedUserId: conversation.assignedUserId });
    if (requiresWindow && !isWithinCustomerServiceWindow(conversation)) {
      throw new ApiError(400, 'OUTSIDE_MESSAGE_WINDOW', "It's been more than 24 hours since the customer's last message — send an approved template to reopen the conversation.");
    }

    const number = await this.numbers.get(conversation.numberId);
    const customer = await this.customers.get(conversation.customerId);
    if (!number || !customer) throw new ApiError(404, 'NOT_FOUND', 'Number or customer was not found.');

    let providerMessageId = '';
    let status: Message['status'] = 'SENT';
    try {
      const response = await sendFn(new ExotelProvider(this.exotelConfig), number, customer);
      providerMessageId = extractOutboundProviderMessageId(response) || '';
      if (!providerMessageId) console.log('sendOutbound: could not extract providerMessageId, raw response:', JSON.stringify(response));
    } catch {
      status = 'FAILED';
    }

    const now = Ids.now();
    const message: Message = {
      id: Ids.create('message'), conversationId, numberId: conversation.numberId, senderUserId: actor.id,
      direction: 'OUTBOUND', messageType, messageText: displayText, providerMessageId, status, timestamp: now,
      ...(templateName ? { templateName } : {}),
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

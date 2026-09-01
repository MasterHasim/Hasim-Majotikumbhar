/**
 * Multi-bot-per-number system (Phase 1, added 2026-09-01, see PROGRESS.md and the approved plan
 * for full context). Mirrors chatbotIntegrationApi.ts's shape 1:1 but scoped to a ChatbotProfile
 * (one of possibly several bots on a number) instead of a WhatsAppNumber directly. Entirely
 * additive: no method here is ever called by the original single-bot code path, and
 * dispatchInboundMessageToChatbotProfiles below refuses to run at all for any number still using
 * the old chatbotMode field, so the two systems can never double-fire for the same message.
 */
import { ApiError } from '../types';
import { Ids } from '../domain/phase1';
import type { ChatbotProfile, ChatbotProfileActivity, ChatbotProfileCredential, Conversation, Customer, Message, WhatsAppNumber } from '../domain/types';
import type { ChatbotProfileDispatchDecision } from './chatbotProfileRouting';
import { decideProfileDispatch } from './chatbotProfileRouting';
import { AppDb } from '../lib/appDb';
import { Repository } from '../lib/repository';
import { timingSafeEqual } from '../lib/auth';
import { ExotelProvider, requireExotelConfig } from './exotelProvider';
import { extractOutboundProviderMessageId, isWithinCustomerServiceWindow, toE164 } from './phase6Api';

const MAX_BOT_REPLY_CHARACTERS = 4_000;

export interface ChatbotProfileReplyInput {
  conversationId: string;
  inReplyToMessageId: string;
  reply?: string;
  handover?: boolean;
  handoverReason?: string;
}

export interface ChatbotProfileConnectionStatus {
  profileId: string;
  numberId: string;
  name: string;
  mode: ChatbotProfile['mode'];
  active: boolean;
  priority: number;
  webhookUrlConfigured: boolean;
  externalProfileId: string;
  apiKeyConfigured: boolean;
  apiKeyPrefix: string;
  keyLastRotatedAt: string;
  latestActivity: ChatbotProfileActivity | null;
}

export interface ChatbotProfileInboundWebhookPayload {
  event: 'inbound_message';
  mode: 'active' | 'shadow';
  profileId: string;
  profileName: string;
  numberId: string;
  numberDisplayName: string;
  conversationId: string;
  messageId: string;
  customerId: string;
  customerPhone: string;
  customerName: string;
  messageType: string;
  messageText: string;
  timestamp: string;
  isNewConversation: boolean;
  isNewCustomer: boolean;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class ChatbotProfileApi {
  private numbers: Repository<WhatsAppNumber>;
  private profiles: Repository<ChatbotProfile>;
  private credentials: Repository<ChatbotProfileCredential>;
  private activities: Repository<ChatbotProfileActivity>;
  private conversations: Repository<Conversation>;
  private customers: Repository<Customer>;
  private messages: Repository<Message>;

  constructor(private db: AppDb, private env: { EXOTEL_API_KEY?: string; EXOTEL_API_TOKEN?: string; EXOTEL_ACCOUNT_SID?: string; EXOTEL_SUBDOMAIN?: string }) {
    this.numbers = new Repository<WhatsAppNumber>(db, 'numbers');
    this.profiles = new Repository<ChatbotProfile>(db, 'chatbotProfiles');
    this.credentials = new Repository<ChatbotProfileCredential>(db, 'chatbotProfileCredentials');
    this.activities = new Repository<ChatbotProfileActivity>(db, 'chatbotProfileActivity');
    this.conversations = new Repository<Conversation>(db, 'webapp_conversations');
    this.customers = new Repository<Customer>(db, 'customers');
    this.messages = new Repository<Message>(db, 'webapp_messages');
  }

  // --- Admin CRUD (caller checked by the route, same pattern as ChatbotIntegrationApi) ---

  async createProfile(numberId: string, input: { name: string; webhookUrl?: string; externalProfileId?: string; mode?: ChatbotProfile['mode'] }): Promise<ChatbotProfile> {
    const number = await this.numbers.get(numberId);
    if (!number) throw new ApiError(404, 'NOT_FOUND', 'WhatsApp number was not found.');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw new ApiError(400, 'VALIDATION_ERROR', 'name is required.');
    const existing = await this.listProfilesForNumber(numberId);
    const now = Ids.now();
    const profile: ChatbotProfile = {
      id: Ids.create('chatbot_profile'), numberId, name,
      mode: input.mode ?? 'off',
      ...(input.webhookUrl ? { webhookUrl: input.webhookUrl.trim() } : {}),
      ...(input.externalProfileId ? { externalProfileId: input.externalProfileId.trim() } : {}),
      priority: existing.length, active: true, createdAt: now, updatedAt: now,
    };
    await this.profiles.create(profile);
    return profile;
  }

  async listProfilesForNumber(numberId: string): Promise<ChatbotProfile[]> {
    return (await this.profiles.list()).filter((p) => p.numberId === numberId).sort((a, b) => a.priority - b.priority);
  }

  async updateProfile(profileId: string, patch: { name?: string; webhookUrl?: string; externalProfileId?: string; mode?: ChatbotProfile['mode']; active?: boolean }): Promise<ChatbotProfile> {
    const profile = await this.profiles.get(profileId);
    if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Chatbot profile was not found.');
    const next: Partial<ChatbotProfile> = {};
    if (typeof patch.name === 'string') { const trimmed = patch.name.trim(); if (!trimmed) throw new ApiError(400, 'VALIDATION_ERROR', 'name cannot be empty.'); next.name = trimmed; }
    if (typeof patch.webhookUrl === 'string') next.webhookUrl = patch.webhookUrl.trim();
    if (typeof patch.externalProfileId === 'string') next.externalProfileId = patch.externalProfileId.trim();
    if (patch.mode) next.mode = patch.mode;
    if (typeof patch.active === 'boolean') next.active = patch.active;
    return this.profiles.update(profileId, next);
  }

  /** Rewrites priority = index for the given order; every id in orderedProfileIds must belong to numberId. */
  async reorderProfiles(numberId: string, orderedProfileIds: string[]): Promise<ChatbotProfile[]> {
    const current = await this.listProfilesForNumber(numberId);
    const currentIds = new Set(current.map((p) => p.id));
    if (orderedProfileIds.length !== current.length || !orderedProfileIds.every((id) => currentIds.has(id))) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'orderedProfileIds must be exactly this number\'s profile ids.');
    }
    for (const [index, profileId] of orderedProfileIds.entries()) {
      await this.profiles.update(profileId, { priority: index });
    }
    return this.listProfilesForNumber(numberId);
  }

  /** Same one-time-reveal contract as ChatbotIntegrationApi.rotateNumberApiKey. */
  async rotateProfileApiKey(profileId: string): Promise<{ profileId: string; apiKey: string; apiKeyPrefix: string; webhookSecret: string; generatedAt: string }> {
    const profile = await this.profiles.get(profileId);
    if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Chatbot profile was not found.');
    const apiKey = `echtcbp_${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
    const keyPrefix = apiKey.slice(0, 15);
    const webhookSecret = `echtcbpwh_${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
    const now = Ids.now();
    const record: ChatbotProfileCredential = { id: profileId, profileId, numberId: profile.numberId, keyHash: await sha256(apiKey), keyPrefix, webhookSecret, createdAt: now, updatedAt: now };
    if (await this.credentials.get(profileId)) await this.credentials.replace(profileId, record);
    else await this.credentials.create(record);
    await this.profiles.update(profileId, { keyPrefix, keyLastRotatedAt: now });
    await this.writeActivity(profileId, profile.numberId, 'KEY_ROTATED', 'Per-profile chatbot API key and webhook secret generated or rotated.');
    return { profileId, apiKey, apiKeyPrefix: keyPrefix, webhookSecret, generatedAt: now };
  }

  async getProfileConnectionStatus(profileId: string): Promise<ChatbotProfileConnectionStatus> {
    const profile = await this.profiles.get(profileId);
    if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Chatbot profile was not found.');
    const [credential, activities] = await Promise.all([this.credentials.get(profileId), this.activities.list()]);
    const latestActivity = activities.filter((a) => a.profileId === profileId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    return {
      profileId, numberId: profile.numberId, name: profile.name, mode: profile.mode, active: profile.active, priority: profile.priority,
      webhookUrlConfigured: !!profile.webhookUrl, externalProfileId: profile.externalProfileId ?? '',
      apiKeyConfigured: !!credential, apiKeyPrefix: credential?.keyPrefix ?? '', keyLastRotatedAt: profile.keyLastRotatedAt ?? '', latestActivity,
    };
  }

  // --- Runtime (outbound notify + inbound reply callback) ---

  /** Best-effort/non-blocking, same contract as ChatbotIntegrationApi.notifyInboundMessage — a
   * chatbot outage or misconfigured URL must never stop a real WhatsApp message from being
   * recorded. Signed with the PROFILE's own webhookSecret (not shared across profiles on the
   * same number), same HMAC-SHA256 `X-Chatbot-Signature: sha256=<hex>` convention. */
  async notifyInboundMessage(number: WhatsAppNumber, conversation: Conversation, message: Message, customer: Customer, decision: Extract<ChatbotProfileDispatchDecision, { action: 'reply' | 'shadow' }>, isNewConversation: boolean, isNewCustomer: boolean): Promise<void> {
    const profile = decision.profile;
    const webhookUrl = profile.webhookUrl;
    if (!webhookUrl) return;
    try {
      const credential = await this.credentials.get(profile.id);
      if (!credential) { await this.writeActivity(profile.id, number.id, 'WEBHOOK_FAILED', 'No chatbot credential configured for this profile — rotate a key first.', conversation.id, message.id); return; }
      const payload: ChatbotProfileInboundWebhookPayload = {
        event: 'inbound_message', mode: decision.action === 'reply' ? 'active' : 'shadow',
        profileId: profile.id, profileName: profile.name,
        numberId: number.id, numberDisplayName: number.displayName, conversationId: conversation.id, messageId: message.id,
        customerId: customer.id, customerPhone: customer.phone, customerName: customer.name,
        messageType: message.messageType, messageText: message.messageText, timestamp: message.timestamp,
        isNewConversation, isNewCustomer,
      };
      const body = JSON.stringify(payload);
      const signature = await hmacSha256Hex(credential.webhookSecret, body);
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Chatbot-Signature': `sha256=${signature}` },
        body,
      });
      if (!res.ok) { await this.writeActivity(profile.id, number.id, 'WEBHOOK_FAILED', `Chatbot webhook returned ${res.status}.`, conversation.id, message.id); return; }
      await this.writeActivity(profile.id, number.id, 'WEBHOOK_SENT', 'Inbound message forwarded to the chatbot webhook.', conversation.id, message.id);
    } catch (err) {
      await this.writeActivity(profile.id, number.id, 'WEBHOOK_FAILED', `Chatbot webhook request failed: ${err instanceof Error ? err.message : String(err)}`, conversation.id, message.id);
    }
  }

  async receiveReply(profileId: string, apiKey: string, input: ChatbotProfileReplyInput): Promise<{ status: 'sent' | 'handover' | 'shadow_recorded' | 'duplicate'; messageId?: string }> {
    await this.requireValidKey(profileId, apiKey);
    const profile = await this.profiles.get(profileId);
    if (!profile || !profile.active) throw new ApiError(404, 'NOT_FOUND', 'Chatbot profile was not found or is inactive.');
    const number = await this.numbers.get(profile.numberId);
    if (!number || !number.active) throw new ApiError(404, 'NOT_FOUND', 'WhatsApp number was not found or is inactive.');
    const mode = profile.mode;
    if (mode === 'off' || mode === 'paused') throw new ApiError(409, 'CHATBOT_DISABLED', `Chatbot mode for this profile is ${mode}.`);

    const conversationId = typeof input.conversationId === 'string' ? input.conversationId : '';
    const inReplyToMessageId = typeof input.inReplyToMessageId === 'string' ? input.inReplyToMessageId : '';
    if (!conversationId || !inReplyToMessageId) throw new ApiError(400, 'VALIDATION_ERROR', 'conversationId and inReplyToMessageId are required.');
    const conversation = await this.conversations.get(conversationId);
    if (!conversation || conversation.numberId !== profile.numberId) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found for this profile\'s WhatsApp number.');
    // Defense-in-depth: even a technically-valid key for SOME profile on this number must not be
    // able to reply into a conversation that was routed to a different profile.
    if (conversation.chatbotProfileId !== profileId) {
      await this.writeActivity(profileId, profile.numberId, 'REPLY_REJECTED_WRONG_PROFILE', `Reply rejected — conversation is assigned to profile ${conversation.chatbotProfileId || '(none)'}, not this one.`, conversationId, inReplyToMessageId);
      throw new ApiError(409, 'CHATBOT_WRONG_PROFILE', 'This conversation is not assigned to this chatbot profile.');
    }
    const inbound = await this.messages.get(inReplyToMessageId);
    if (!inbound || inbound.conversationId !== conversationId || inbound.numberId !== profile.numberId || inbound.direction !== 'INBOUND') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'inReplyToMessageId must reference an inbound message in this conversation.');
    }
    if (await this.messages.findOne((message) => message.chatbotInReplyToMessageId === inReplyToMessageId)) return { status: 'duplicate' };

    const reply = typeof input.reply === 'string' ? input.reply.trim() : '';
    const handover = input.handover === true;
    if (!reply && !handover) throw new ApiError(400, 'VALIDATION_ERROR', 'reply is required unless handover is true.');
    if (reply.length > MAX_BOT_REPLY_CHARACTERS) throw new ApiError(400, 'VALIDATION_ERROR', `reply must not exceed ${MAX_BOT_REPLY_CHARACTERS} characters.`);

    if (mode === 'shadow') {
      await this.writeActivity(profileId, profile.numberId, 'SHADOW_REPLY_RECEIVED', reply ? `Draft received (${reply.length} characters); not sent in shadow mode.` : 'Handover received; not applied in shadow mode.', conversationId, inReplyToMessageId);
      return { status: 'shadow_recorded' };
    }
    if (conversation.chatbotState === 'HUMAN') throw new ApiError(409, 'CHATBOT_HANDED_OFF', 'This conversation is owned by the team.');

    let messageId: string | undefined;
    if (reply) {
      if (!isWithinCustomerServiceWindow(conversation)) throw new ApiError(400, 'OUTSIDE_MESSAGE_WINDOW', 'The WhatsApp customer-service window is closed; chatbot free-text replies cannot be sent.');
      const customer = await this.customers.get(conversation.customerId);
      if (!customer) throw new ApiError(404, 'NOT_FOUND', 'Customer was not found.');
      let providerMessageId = '';
      let status: Message['status'] = 'SENT';
      try {
        const provider = new ExotelProvider(requireExotelConfig(this.env));
        const response = await provider.sendText(toE164(number.phoneNumber), toE164(customer.phone), reply);
        providerMessageId = extractOutboundProviderMessageId(response) ?? '';
      } catch {
        status = 'FAILED';
      }
      const message: Message = { id: Ids.create('message'), conversationId, numberId: profile.numberId, senderUserId: 'chatbot', direction: 'OUTBOUND', messageType: 'text', messageText: reply, providerMessageId, chatbotInReplyToMessageId: inReplyToMessageId, status, timestamp: Ids.now() };
      await this.messages.create(message);
      messageId = message.id;
      if (status === 'FAILED') {
        await this.writeActivity(profileId, profile.numberId, 'REPLY_REJECTED', 'Chatbot reply could not be delivered to WhatsApp.', conversationId, inReplyToMessageId);
        throw new ApiError(502, 'CHATBOT_REPLY_SEND_FAILED', 'Chatbot reply could not be sent to WhatsApp.');
      }
      await this.writeActivity(profileId, profile.numberId, 'REPLY_SENT', 'Chatbot reply sent to WhatsApp.', conversationId, inReplyToMessageId);
    }

    if (handover) {
      await this.conversations.update(conversationId, { chatbotState: 'HUMAN', chatbotHandoffAt: Ids.now(), chatbotHandoffReason: String(input.handoverReason ?? 'chatbot_requested_handover').slice(0, 200), needsResponse: true, lastMessageAt: Ids.now() });
      await this.writeActivity(profileId, profile.numberId, 'HANDOVER', 'Chatbot handed the conversation to the team.', conversationId, inReplyToMessageId);
      return { status: 'handover', ...(messageId ? { messageId } : {}) };
    }
    if (messageId) await this.conversations.update(conversationId, { needsResponse: false, lastMessageAt: Ids.now() });
    return { status: 'sent', messageId };
  }

  private async requireValidKey(profileId: string, apiKey: string): Promise<void> {
    const credential = await this.credentials.get(profileId);
    if (!credential || !apiKey || !timingSafeEqual(credential.keyHash, await sha256(apiKey))) throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid chatbot API key.');
  }

  private async writeActivity(profileId: string, numberId: string, kind: ChatbotProfileActivity['kind'], detail: string, conversationId?: string, inReplyToMessageId?: string): Promise<void> {
    const now = Ids.now();
    await this.activities.create({ id: Ids.create('chatbot_profile_activity'), profileId, numberId, kind, detail, ...(conversationId ? { conversationId } : {}), ...(inReplyToMessageId ? { inReplyToMessageId } : {}), createdAt: now, updatedAt: now });
  }
}

/**
 * The ONLY new call added to Phase4Api.ingestInboundMessage. Guarded so it is a strict no-op for
 * every number in production today: a number still using the OLD single-bot path (chatbotMode
 * set and not 'off') is skipped entirely — this makes the double-notify risk structurally
 * impossible, not just an operational discipline to remember — and a number with zero
 * ChatbotProfile rows does one empty list() read and returns. Never allowed to fail ingestion.
 */
export async function dispatchInboundMessageToChatbotProfiles(
  db: AppDb,
  env: { EXOTEL_API_KEY?: string; EXOTEL_API_TOKEN?: string; EXOTEL_ACCOUNT_SID?: string; EXOTEL_SUBDOMAIN?: string },
  number: WhatsAppNumber,
  conversation: Conversation,
  message: Message,
  customer: Customer,
  isNewConversation: boolean,
  isNewCustomer: boolean,
): Promise<void> {
  try {
    if (number.chatbotMode && number.chatbotMode !== 'off') return;
    const profilesRepo = new Repository<ChatbotProfile>(db, 'chatbotProfiles');
    const numberProfiles = (await profilesRepo.list()).filter((p) => p.numberId === number.id);
    if (numberProfiles.length === 0) return;
    const decision = decideProfileDispatch(numberProfiles, conversation);
    if (decision.action !== 'reply' && decision.action !== 'shadow') return;
    if (!conversation.chatbotProfileId) {
      await new Repository<Conversation>(db, 'webapp_conversations').update(conversation.id, { chatbotProfileId: decision.profile.id });
    }
    await new ChatbotProfileApi(db, env).notifyInboundMessage(number, conversation, message, customer, decision, isNewConversation, isNewCustomer);
  } catch {
    // Never allowed to fail ingestion — same non-blocking contract as the single-bot adapter.
  }
}

import { ApiError } from '../types';
import { Ids } from '../domain/phase1';
import type { ChatbotConnectionActivity, ChatbotIntegrationCredential, Conversation, Customer, Message, WhatsAppNumber } from '../domain/types';
import { AppDb } from '../lib/appDb';
import { Repository } from '../lib/repository';
import { timingSafeEqual } from '../lib/auth';
import { ExotelProvider, requireExotelConfig } from './exotelProvider';
import { extractOutboundProviderMessageId, isWithinCustomerServiceWindow, toE164 } from './phase6Api';

const MAX_BOT_REPLY_CHARACTERS = 4_000;

export interface ChatbotReplyInput {
  conversationId: string;
  inReplyToMessageId: string;
  reply?: string;
  handover?: boolean;
  handoverReason?: string;
}

export interface ChatbotConnectionStatus {
  numberId: string;
  mode: WhatsAppNumber['chatbotMode'];
  webhookUrlConfigured: boolean;
  profileId: string;
  apiKeyConfigured: boolean;
  apiKeyPrefix: string;
  keyLastRotatedAt: string;
  latestActivity: ChatbotConnectionActivity | null;
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

/** Per-number server-to-server API. It deliberately never exposes Firebase, user, or provider credentials to the chatbot. */
export class ChatbotIntegrationApi {
  private numbers: Repository<WhatsAppNumber>;
  private credentials: Repository<ChatbotIntegrationCredential>;
  private activities: Repository<ChatbotConnectionActivity>;
  private conversations: Repository<Conversation>;
  private customers: Repository<Customer>;
  private messages: Repository<Message>;

  constructor(private db: AppDb, private env: { EXOTEL_API_KEY?: string; EXOTEL_API_TOKEN?: string; EXOTEL_ACCOUNT_SID?: string; EXOTEL_SUBDOMAIN?: string }) {
    this.numbers = new Repository<WhatsAppNumber>(db, 'numbers');
    this.credentials = new Repository<ChatbotIntegrationCredential>(db, 'chatbotIntegrationCredentials');
    this.activities = new Repository<ChatbotConnectionActivity>(db, 'chatbotConnectionActivity');
    this.conversations = new Repository<Conversation>(db, 'webapp_conversations');
    this.customers = new Repository<Customer>(db, 'customers');
    this.messages = new Repository<Message>(db, 'webapp_messages');
  }

  /** ADMIN-only caller is checked by the route. The plaintext key exists only in this response. */
  async rotateNumberApiKey(numberId: string): Promise<{ numberId: string; apiKey: string; apiKeyPrefix: string; generatedAt: string }> {
    const number = await this.numbers.get(numberId);
    if (!number) throw new ApiError(404, 'NOT_FOUND', 'WhatsApp number was not found.');
    const apiKey = `echtcb_${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
    const keyPrefix = apiKey.slice(0, 15);
    const now = Ids.now();
    const record: ChatbotIntegrationCredential = { id: numberId, numberId, keyHash: await sha256(apiKey), keyPrefix, createdAt: now, updatedAt: now };
    if (await this.credentials.get(numberId)) await this.credentials.replace(numberId, record);
    else await this.credentials.create(record);
    await this.numbers.update(numberId, { chatbotKeyPrefix: keyPrefix, chatbotKeyLastRotatedAt: now });
    await this.writeActivity(numberId, 'KEY_ROTATED', 'Per-number chatbot API key generated or rotated.');
    return { numberId, apiKey, apiKeyPrefix: keyPrefix, generatedAt: now };
  }

  async getConnectionStatus(numberId: string): Promise<ChatbotConnectionStatus> {
    const number = await this.numbers.get(numberId);
    if (!number) throw new ApiError(404, 'NOT_FOUND', 'WhatsApp number was not found.');
    const [credential, activities] = await Promise.all([this.credentials.get(numberId), this.activities.list()]);
    const latestActivity = activities.filter((activity) => activity.numberId === numberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    return {
      numberId, mode: number.chatbotMode ?? 'off', webhookUrlConfigured: !!number.chatbotWebhookUrl,
      profileId: number.chatbotProfileId ?? '', apiKeyConfigured: !!credential,
      apiKeyPrefix: credential?.keyPrefix ?? '', keyLastRotatedAt: number.chatbotKeyLastRotatedAt ?? '', latestActivity,
    };
  }

  async receiveReply(numberId: string, apiKey: string, input: ChatbotReplyInput): Promise<{ status: 'sent' | 'handover' | 'shadow_recorded' | 'duplicate'; messageId?: string }> {
    await this.requireValidKey(numberId, apiKey);
    const number = await this.numbers.get(numberId);
    if (!number || !number.active) throw new ApiError(404, 'NOT_FOUND', 'WhatsApp number was not found or is inactive.');
    const mode = number.chatbotMode ?? 'off';
    if (mode === 'off' || mode === 'paused') throw new ApiError(409, 'CHATBOT_DISABLED', `Chatbot mode for this number is ${mode}.`);
    const conversationId = typeof input.conversationId === 'string' ? input.conversationId : '';
    const inReplyToMessageId = typeof input.inReplyToMessageId === 'string' ? input.inReplyToMessageId : '';
    if (!conversationId || !inReplyToMessageId) throw new ApiError(400, 'VALIDATION_ERROR', 'conversationId and inReplyToMessageId are required.');
    const conversation = await this.conversations.get(conversationId);
    if (!conversation || conversation.numberId !== numberId) throw new ApiError(404, 'NOT_FOUND', 'Conversation was not found for this WhatsApp number.');
    const inbound = await this.messages.get(inReplyToMessageId);
    if (!inbound || inbound.conversationId !== conversationId || inbound.numberId !== numberId || inbound.direction !== 'INBOUND') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'inReplyToMessageId must reference an inbound message in this conversation.');
    }
    if (await this.messages.findOne((message) => message.chatbotInReplyToMessageId === inReplyToMessageId)) return { status: 'duplicate' };

    const reply = typeof input.reply === 'string' ? input.reply.trim() : '';
    const handover = input.handover === true;
    if (!reply && !handover) throw new ApiError(400, 'VALIDATION_ERROR', 'reply is required unless handover is true.');
    if (reply.length > MAX_BOT_REPLY_CHARACTERS) throw new ApiError(400, 'VALIDATION_ERROR', `reply must not exceed ${MAX_BOT_REPLY_CHARACTERS} characters.`);

    if (mode === 'shadow') {
      await this.writeActivity(numberId, 'SHADOW_REPLY_RECEIVED', reply ? `Draft received (${reply.length} characters); not sent in shadow mode.` : 'Handover received; not applied in shadow mode.', conversationId, inReplyToMessageId);
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
      const message: Message = { id: Ids.create('message'), conversationId, numberId, senderUserId: 'chatbot', direction: 'OUTBOUND', messageType: 'text', messageText: reply, providerMessageId, chatbotInReplyToMessageId: inReplyToMessageId, status, timestamp: Ids.now() };
      await this.messages.create(message);
      messageId = message.id;
      if (status === 'FAILED') {
        await this.writeActivity(numberId, 'REPLY_REJECTED', 'Chatbot reply could not be delivered to WhatsApp.', conversationId, inReplyToMessageId);
        throw new ApiError(502, 'CHATBOT_REPLY_SEND_FAILED', 'Chatbot reply could not be sent to WhatsApp.');
      }
      await this.writeActivity(numberId, 'REPLY_SENT', 'Chatbot reply sent to WhatsApp.', conversationId, inReplyToMessageId);
    }

    if (handover) {
      await this.conversations.update(conversationId, { chatbotState: 'HUMAN', chatbotHandoffAt: Ids.now(), chatbotHandoffReason: String(input.handoverReason ?? 'chatbot_requested_handover').slice(0, 200), needsResponse: true, lastMessageAt: Ids.now() });
      await this.writeActivity(numberId, 'HANDOVER', 'Chatbot handed the conversation to the team.', conversationId, inReplyToMessageId);
      return { status: 'handover', ...(messageId ? { messageId } : {}) };
    }
    if (messageId) await this.conversations.update(conversationId, { needsResponse: false, lastMessageAt: Ids.now() });
    return { status: 'sent', messageId };
  }

  private async requireValidKey(numberId: string, apiKey: string): Promise<void> {
    const credential = await this.credentials.get(numberId);
    if (!credential || !apiKey || !timingSafeEqual(credential.keyHash, await sha256(apiKey))) throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid chatbot API key.');
  }

  private async writeActivity(numberId: string, kind: ChatbotConnectionActivity['kind'], detail: string, conversationId?: string, inReplyToMessageId?: string): Promise<void> {
    const now = Ids.now();
    await this.activities.create({ id: Ids.create('chatbot_activity'), numberId, kind, detail, ...(conversationId ? { conversationId } : {}), ...(inReplyToMessageId ? { inReplyToMessageId } : {}), createdAt: now, updatedAt: now });
  }
}

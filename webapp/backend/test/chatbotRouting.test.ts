import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { Phase3Api } from '../src/services/phase3Api';
import { decideInboundChatbotRouting } from '../src/services/chatbotRouting';
import { ChatbotIntegrationApi } from '../src/services/chatbotIntegrationApi';
import { Phase4Api } from '../src/services/phase4Api';
import { Roles } from '../src/domain/phase1';
import type { Conversation, WhatsAppNumber } from '../src/domain/types';

const ADMIN_EMAIL = 'admin@example.com';

function number(chatbotMode?: WhatsAppNumber['chatbotMode']): WhatsAppNumber {
  return { id: 'number-1', displayName: 'Test', phoneNumber: '+919876543210', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, chatbotMode, createdAt: '', updatedAt: '' };
}
function conversation(chatbotState?: Conversation['chatbotState']): Conversation {
  return { id: 'conversation-1', customerId: 'customer-1', numberId: 'number-1', assignedUserId: '', status: 'OPEN', needsResponse: true, lastMessageAt: '', createdAt: '', updatedAt: '', chatbotState };
}

describe('per-number chatbot modes', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;

  beforeEach(async () => {
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);
    await new Phase1Api(db, ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, ADMIN_EMAIL);
  });
  afterEach(() => mock.restore());

  it('defaults newly-created numbers to off and validates admin updates', async () => {
    const api = new Phase3Api(db, ADMIN_EMAIL);
    const created = await api.createNumber({ displayName: 'Bot test', phoneNumber: '+919876500001', provider: 'exotel' });
    expect(created.chatbotMode).toBe('off');
    await expect(api.updateNumber(created.id, { chatbotMode: 'invalid' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await api.updateNumber(created.id, { chatbotMode: 'shadow' })).chatbotMode).toBe('shadow');
  });

  it.each([
    ['off', undefined, 'disabled'],
    ['paused', undefined, 'disabled'],
    ['shadow', undefined, 'shadow'],
    ['active', undefined, 'reply'],
    ['active', 'HUMAN', 'blocked_by_human'],
  ] as const)('routes %s safely with conversation state %s', (mode, state, action) => {
    expect(decideInboundChatbotRouting(number(mode), conversation(state)).action).toBe(action);
  });

  it('creates a separate one-time key and records a shadow callback without sending WhatsApp', async () => {
    const numbers = new Phase3Api(db, ADMIN_EMAIL);
    const created = await numbers.createNumber({ displayName: 'Chatbot number', phoneNumber: '+917948502801', provider: 'exotel' });
    await numbers.updateNumber(created.id, { chatbotMode: 'shadow', chatbotWebhookUrl: 'https://bot.internal.example/inbound', chatbotProfileId: 'location-sales' });
    const incoming = await new Phase4Api(db).ingestInboundMessage({
      providerMessageId: 'inbound-chatbot-1', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Need prices', timestamp: new Date().toISOString(), status: null,
    });
    const api = new ChatbotIntegrationApi(db, {});
    const key = await api.rotateNumberApiKey(created.id);
    expect(key.apiKey).toMatch(/^echtcb_/);
    await expect(api.receiveReply(created.id, 'wrong-key', { conversationId: incoming.conversationId!, inReplyToMessageId: incoming.messageId!, reply: 'Draft pricing response' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(api.receiveReply(created.id, key.apiKey, { conversationId: incoming.conversationId!, inReplyToMessageId: incoming.messageId!, reply: 'Draft pricing response' })).resolves.toEqual({ status: 'shadow_recorded' });
    const status = await api.getConnectionStatus(created.id);
    expect(status).toMatchObject({ mode: 'shadow', webhookUrlConfigured: true, profileId: 'location-sales', apiKeyConfigured: true });
    expect(status.latestActivity?.kind).toBe('SHADOW_REPLY_RECEIVED');
  });
});

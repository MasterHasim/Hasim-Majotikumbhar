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

  describe('notifyInboundMessage (the outbound half — actually delivering to the chatbot\'s webhook, 2026-08-31)', () => {
    async function hmacHex(secret: string, body: string): Promise<string> {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
      return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    it('POSTs the inbound message to the number\'s webhook URL, signed with the per-number secret, when mode is active', async () => {
      const numbers = new Phase3Api(db, ADMIN_EMAIL);
      const created = await numbers.createNumber({ displayName: 'Chatbot number', phoneNumber: '+917948502802', provider: 'exotel' });
      const key = await new ChatbotIntegrationApi(db, {}).rotateNumberApiKey(created.id);
      await numbers.updateNumber(created.id, { chatbotMode: 'active', chatbotWebhookUrl: 'https://bot.internal.example/inbound' });

      let captured: { url: string; body: string; signature: string | null } | null = null;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url === 'https://bot.internal.example/inbound') {
          captured = { url, body: init!.body as string, signature: (init!.headers as Record<string, string>)['X-Chatbot-Signature'] ?? null };
          return new Response('ok', { status: 200 });
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      try {
        await new Phase4Api(db).ingestInboundMessage({
          providerMessageId: 'inbound-chatbot-active-1', fromPhone: '+919876543299', providerNumberId: '+917948502802',
          direction: 'INBOUND', messageType: 'text', text: 'Hello, need help', timestamp: new Date().toISOString(), status: null, profileName: 'Priya',
        });
      } finally {
        globalThis.fetch = originalFetch;
      }

      expect(captured).not.toBeNull();
      const payload = JSON.parse(captured!.body);
      expect(payload).toMatchObject({ event: 'inbound_message', mode: 'active', numberId: created.id, customerPhone: '+919876543299', customerName: 'Priya', messageText: 'Hello, need help', isNewConversation: true, isNewCustomer: true });
      expect(captured!.signature).toBe(`sha256=${await hmacHex(key.webhookSecret, captured!.body)}`);

      const status = await new ChatbotIntegrationApi(db, {}).getConnectionStatus(created.id);
      expect(status.latestActivity?.kind).toBe('WEBHOOK_SENT');
    });

    it('never throws and never blocks ingestion when the webhook call fails', async () => {
      const numbers = new Phase3Api(db, ADMIN_EMAIL);
      const created = await numbers.createNumber({ displayName: 'Chatbot number', phoneNumber: '+917948502803', provider: 'exotel' });
      await new ChatbotIntegrationApi(db, {}).rotateNumberApiKey(created.id);
      await numbers.updateNumber(created.id, { chatbotMode: 'active', chatbotWebhookUrl: 'https://bot.internal.example/unreachable' });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url === 'https://bot.internal.example/unreachable') throw new Error('network unreachable');
        return originalFetch(input, init);
      }) as typeof fetch;

      let result;
      try {
        result = await new Phase4Api(db).ingestInboundMessage({
          providerMessageId: 'inbound-chatbot-fail-1', fromPhone: '+919876543298', providerNumberId: '+917948502803',
          direction: 'INBOUND', messageType: 'text', text: 'Hello', timestamp: new Date().toISOString(), status: null,
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
      expect(result.duplicate).toBe(false); // ingestion succeeded regardless

      const status = await new ChatbotIntegrationApi(db, {}).getConnectionStatus(created.id);
      expect(status.latestActivity?.kind).toBe('WEBHOOK_FAILED');
    });

    it('does not call the webhook at all when mode is off/paused, or when the conversation is already handed off to a human', async () => {
      const numbers = new Phase3Api(db, ADMIN_EMAIL);
      const created = await numbers.createNumber({ displayName: 'Chatbot number', phoneNumber: '+917948502804', provider: 'exotel' });
      await new ChatbotIntegrationApi(db, {}).rotateNumberApiKey(created.id);
      await numbers.updateNumber(created.id, { chatbotMode: 'off', chatbotWebhookUrl: 'https://bot.internal.example/should-not-be-called' });

      const originalFetch = globalThis.fetch;
      let called = false;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url === 'https://bot.internal.example/should-not-be-called') { called = true; return new Response('ok', { status: 200 }); }
        return originalFetch(input, init);
      }) as typeof fetch;

      try {
        await new Phase4Api(db).ingestInboundMessage({
          providerMessageId: 'inbound-chatbot-off-1', fromPhone: '+919876543297', providerNumberId: '+917948502804',
          direction: 'INBOUND', messageType: 'text', text: 'Hello', timestamp: new Date().toISOString(), status: null,
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
      expect(called).toBe(false);
    });
  });
});

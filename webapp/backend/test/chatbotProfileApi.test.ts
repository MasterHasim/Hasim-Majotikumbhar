import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { Phase3Api } from '../src/services/phase3Api';
import { Phase4Api } from '../src/services/phase4Api';
import { ChatbotProfileApi } from '../src/services/chatbotProfileApi';
import { ChatbotIntegrationApi } from '../src/services/chatbotIntegrationApi';

const ADMIN_EMAIL = 'admin@example.com';

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Intercepts fetch calls to the given webhook URLs, letting everything else (Firebase, Exotel
 * mocks) fall through to whatever fetch is currently installed — same pattern chatbotRouting.test.ts uses. */
function captureWebhookCalls(urls: string[]) {
  const calls: Record<string, { body: string; signature: string | null }[]> = Object.fromEntries(urls.map((u) => [u, []]));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (urls.includes(url)) {
      calls[url]!.push({ body: init!.body as string, signature: (init!.headers as Record<string, string>)['X-Chatbot-Signature'] ?? null });
      return new Response('ok', { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

describe('multi-bot-per-number chatbot profiles (Phase 1, added 2026-09-01)', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;

  beforeEach(async () => {
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);
    await new Phase1Api(db, ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, ADMIN_EMAIL);
  });
  afterEach(() => mock.restore());

  it('routes the first inbound message to the highest-priority (lowest number) eligible profile and sticks with it after reordering', async () => {
    const numbers = new Phase3Api(db, ADMIN_EMAIL);
    const created = await numbers.createNumber({ displayName: 'Multi-bot number', phoneNumber: '+917948502810', provider: 'exotel' });
    const profileApi = new ChatbotProfileApi(db, {});
    const sales = await profileApi.createProfile(created.id, { name: 'Sales Bot', mode: 'active', webhookUrl: 'https://sales.example/inbound' });
    const support = await profileApi.createProfile(created.id, { name: 'Support Bot', mode: 'active', webhookUrl: 'https://support.example/inbound' });
    await profileApi.rotateProfileApiKey(sales.id);
    await profileApi.rotateProfileApiKey(support.id);
    expect(sales.priority).toBeLessThan(support.priority); // created first == higher priority

    const capture = captureWebhookCalls(['https://sales.example/inbound', 'https://support.example/inbound']);
    let incoming;
    try {
      incoming = await new Phase4Api(db).ingestInboundMessage({
        providerMessageId: 'multi-bot-1', fromPhone: '+919876540001', providerNumberId: '+917948502810',
        direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null,
      });
    } finally { capture.restore(); }
    expect(capture.calls['https://sales.example/inbound']!.length).toBe(1);
    expect(capture.calls['https://support.example/inbound']!.length).toBe(0);

    const conversation = await db.get<{ chatbotProfileId?: string }>(`webapp_conversations/${incoming.conversationId}`);
    expect(conversation?.chatbotProfileId).toBe(sales.id);

    // Reorder so Support is now higher priority than Sales.
    await profileApi.reorderProfiles(created.id, [support.id, sales.id]);

    const capture2 = captureWebhookCalls(['https://sales.example/inbound', 'https://support.example/inbound']);
    try {
      await new Phase4Api(db).ingestInboundMessage({
        providerMessageId: 'multi-bot-2', fromPhone: '+919876540001', providerNumberId: '+917948502810',
        direction: 'INBOUND', messageType: 'text', text: 'Second message, same conversation', timestamp: new Date().toISOString(), status: null,
      });
    } finally { capture2.restore(); }
    // Sticky: still Sales, even though Support is now higher priority.
    expect(capture2.calls['https://sales.example/inbound']!.length).toBe(1);
    expect(capture2.calls['https://support.example/inbound']!.length).toBe(0);
  });

  it('signs the outbound webhook with the PROFILE\'s own webhook secret, not shared across profiles on the same number', async () => {
    const numbers = new Phase3Api(db, ADMIN_EMAIL);
    const created = await numbers.createNumber({ displayName: 'Signed number', phoneNumber: '+917948502811', provider: 'exotel' });
    const profileApi = new ChatbotProfileApi(db, {});
    const profile = await profileApi.createProfile(created.id, { name: 'Only Bot', mode: 'active', webhookUrl: 'https://onlybot.example/inbound' });
    const key = await profileApi.rotateProfileApiKey(profile.id);

    const capture = captureWebhookCalls(['https://onlybot.example/inbound']);
    try {
      await new Phase4Api(db).ingestInboundMessage({
        providerMessageId: 'signed-1', fromPhone: '+919876540002', providerNumberId: '+917948502811',
        direction: 'INBOUND', messageType: 'text', text: 'Sign me', timestamp: new Date().toISOString(), status: null,
      });
    } finally { capture.restore(); }
    const call = capture.calls['https://onlybot.example/inbound']![0]!;
    const payload = JSON.parse(call.body);
    expect(payload).toMatchObject({ event: 'inbound_message', mode: 'active', profileId: profile.id, profileName: 'Only Bot', messageText: 'Sign me' });
    expect(call.signature).toBe(`sha256=${await hmacHex(key.webhookSecret, call.body)}`);

    const status = await profileApi.getProfileConnectionStatus(profile.id);
    expect(status.latestActivity?.kind).toBe('WEBHOOK_SENT');
  });

  it('rejects profile B\'s reply-callback key when used against profile A\'s route (401)', async () => {
    const numbers = new Phase3Api(db, ADMIN_EMAIL);
    const created = await numbers.createNumber({ displayName: 'Cross-key number', phoneNumber: '+917948502812', provider: 'exotel' });
    const profileApi = new ChatbotProfileApi(db, {});
    const a = await profileApi.createProfile(created.id, { name: 'A', mode: 'active' });
    const b = await profileApi.createProfile(created.id, { name: 'B', mode: 'active' });
    const keyA = await profileApi.rotateProfileApiKey(a.id);
    await profileApi.rotateProfileApiKey(b.id);

    await expect(profileApi.receiveReply(a.id, 'not-a-real-key', { conversationId: 'x', inReplyToMessageId: 'y' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(profileApi.receiveReply(b.id, keyA.apiKey, { conversationId: 'x', inReplyToMessageId: 'y' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a reply from a valid profile whose key is correct but the conversation was routed to a DIFFERENT profile on the same number (409 CHATBOT_WRONG_PROFILE)', async () => {
    const numbers = new Phase3Api(db, ADMIN_EMAIL);
    const created = await numbers.createNumber({ displayName: 'Wrong-profile number', phoneNumber: '+917948502813', provider: 'exotel' });
    const profileApi = new ChatbotProfileApi(db, {});
    const assigned = await profileApi.createProfile(created.id, { name: 'Assigned', mode: 'active', webhookUrl: 'https://assigned.example/inbound' });
    const other = await profileApi.createProfile(created.id, { name: 'Other', mode: 'active', webhookUrl: 'https://other.example/inbound' });
    await profileApi.rotateProfileApiKey(assigned.id);
    const otherKey = await profileApi.rotateProfileApiKey(other.id);

    const capture = captureWebhookCalls(['https://assigned.example/inbound', 'https://other.example/inbound']);
    let incoming;
    try {
      incoming = await new Phase4Api(db).ingestInboundMessage({
        providerMessageId: 'wrong-profile-1', fromPhone: '+919876540003', providerNumberId: '+917948502813',
        direction: 'INBOUND', messageType: 'text', text: 'Hello', timestamp: new Date().toISOString(), status: null,
      });
    } finally { capture.restore(); }
    // 'assigned' has the lower (default) priority from creation order, so it wins first dispatch.
    const conversation = await db.get<{ chatbotProfileId?: string }>(`webapp_conversations/${incoming.conversationId}`);
    expect(conversation?.chatbotProfileId).toBe(assigned.id);

    await expect(
      profileApi.receiveReply(other.id, otherKey.apiKey, { conversationId: incoming.conversationId!, inReplyToMessageId: incoming.messageId!, reply: 'I should not be able to reply here' }),
    ).rejects.toMatchObject({ code: 'CHATBOT_WRONG_PROFILE' });

    const status = await profileApi.getProfileConnectionStatus(other.id);
    expect(status.latestActivity?.kind).toBe('REPLY_REJECTED_WRONG_PROFILE');
  });

  it('shadow mode records the callback without sending, and handover sets HUMAN state — same behavior as the single-bot system', async () => {
    const numbers = new Phase3Api(db, ADMIN_EMAIL);
    const created = await numbers.createNumber({ displayName: 'Shadow number', phoneNumber: '+917948502814', provider: 'exotel' });
    const profileApi = new ChatbotProfileApi(db, {});
    const profile = await profileApi.createProfile(created.id, { name: 'Shadow Bot', mode: 'shadow' });
    const key = await profileApi.rotateProfileApiKey(profile.id);

    const incoming = await new Phase4Api(db).ingestInboundMessage({
      providerMessageId: 'shadow-1', fromPhone: '+919876540004', providerNumberId: '+917948502814',
      direction: 'INBOUND', messageType: 'text', text: 'Need a quote', timestamp: new Date().toISOString(), status: null,
    });
    await expect(profileApi.receiveReply(profile.id, key.apiKey, { conversationId: incoming.conversationId!, inReplyToMessageId: incoming.messageId!, reply: 'Draft answer' })).resolves.toEqual({ status: 'shadow_recorded' });
    expect((await profileApi.getProfileConnectionStatus(profile.id)).latestActivity?.kind).toBe('SHADOW_REPLY_RECEIVED');

    await profileApi.updateProfile(profile.id, { mode: 'active' });
    const incoming2 = await new Phase4Api(db).ingestInboundMessage({
      providerMessageId: 'shadow-2', fromPhone: '+919876540004', providerNumberId: '+917948502814',
      direction: 'INBOUND', messageType: 'text', text: 'Please connect me to a person', timestamp: new Date().toISOString(), status: null,
    });
    const result = await profileApi.receiveReply(profile.id, key.apiKey, { conversationId: incoming2.conversationId!, inReplyToMessageId: incoming2.messageId!, handover: true, handoverReason: 'customer_requested' });
    expect(result.status).toBe('handover');
    const conversation = await db.get<{ chatbotState?: string }>(`webapp_conversations/${incoming2.conversationId}`);
    expect(conversation?.chatbotState).toBe('HUMAN');
  });

  it('coexistence: a number still on the OLD single-bot path (chatbotMode active) never triggers the new profile dispatch, even with live ChatbotProfile records present for it', async () => {
    const numbers = new Phase3Api(db, ADMIN_EMAIL);
    const created = await numbers.createNumber({ displayName: 'Legacy number', phoneNumber: '+917948502815', provider: 'exotel' });
    await new ChatbotIntegrationApi(db, {}).rotateNumberApiKey(created.id);
    await numbers.updateNumber(created.id, { chatbotMode: 'active', chatbotWebhookUrl: 'https://legacy.example/inbound' });

    const profileApi = new ChatbotProfileApi(db, {});
    // A profile accidentally left configured for this number — must never fire.
    const stray = await profileApi.createProfile(created.id, { name: 'Should never fire', mode: 'active', webhookUrl: 'https://stray-profile.example/inbound' });
    await profileApi.rotateProfileApiKey(stray.id);

    const capture = captureWebhookCalls(['https://legacy.example/inbound', 'https://stray-profile.example/inbound']);
    let incoming;
    try {
      incoming = await new Phase4Api(db).ingestInboundMessage({
        providerMessageId: 'coexist-1', fromPhone: '+919876540005', providerNumberId: '+917948502815',
        direction: 'INBOUND', messageType: 'text', text: 'Hello legacy', timestamp: new Date().toISOString(), status: null,
      });
    } finally { capture.restore(); }

    expect(capture.calls['https://legacy.example/inbound']!.length).toBe(1); // old system fired
    expect(capture.calls['https://stray-profile.example/inbound']!.length).toBe(0); // new system did not

    const conversation = await db.get<{ chatbotProfileId?: string }>(`webapp_conversations/${incoming.conversationId}`);
    expect(conversation?.chatbotProfileId).toBeUndefined(); // never touched by the guarded-off dispatcher
  });

  it('a number with zero ChatbotProfile records is a true no-op for the new dispatcher — ingestion still succeeds normally', async () => {
    const numbers = new Phase3Api(db, ADMIN_EMAIL);
    const created = await numbers.createNumber({ displayName: 'No profiles number', phoneNumber: '+917948502816', provider: 'exotel' });
    const incoming = await new Phase4Api(db).ingestInboundMessage({
      providerMessageId: 'no-profiles-1', fromPhone: '+919876540006', providerNumberId: '+917948502816',
      direction: 'INBOUND', messageType: 'text', text: 'Hello', timestamp: new Date().toISOString(), status: null,
    });
    expect(incoming.duplicate).toBe(false);
    const conversation = await db.get<{ chatbotProfileId?: string }>(`webapp_conversations/${incoming.conversationId}`);
    expect(conversation?.chatbotProfileId).toBeUndefined();
  });
});

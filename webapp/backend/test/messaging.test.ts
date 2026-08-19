import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { Phase3Api } from '../src/services/phase3Api';
import { Phase4Api } from '../src/services/phase4Api';
import { Phase5Api } from '../src/services/phase5Api';
import { Phase6Api } from '../src/services/phase6Api';
import { WorkspaceApi } from '../src/services/workspaceApi';
import { ExotelProvider } from '../src/services/exotelProvider';
import { Roles } from '../src/domain/phase1';

const ADMIN_EMAIL = 'admin@example.com';
const AGENT_EMAIL = 'agent@example.com';

describe('Messaging core (ported from Phase 3-6 + WorkspaceServices.gs)', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;
  let agentId: string;
  let numberId: string;

  beforeEach(async () => {
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);

    await new Phase1Api(db, ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, ADMIN_EMAIL);
    const agent = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: AGENT_EMAIL, displayName: 'Agent', roleIds: [] });
    agentId = agent.id;
    const roles = await new Phase1Api(db, ADMIN_EMAIL).listRoles();
    const agentRoleId = roles.find((r) => r.key === Roles.AGENT)!.id;
    await new Phase1Api(db, ADMIN_EMAIL).updateUser(agentId, { roleIds: [agentRoleId] });

    const number = await new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'Test Number', phoneNumber: '079-485-02801', provider: 'exotel' });
    numberId = number.id;
    await new Phase1Api(db, ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId });
  });

  afterEach(() => mock.restore());

  describe('Phase3Api — numbers', () => {
    it('rejects a duplicate phoneNumber', async () => {
      await expect(new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'Dup', phoneNumber: '079-485-02801', provider: 'exotel' })).rejects.toMatchObject({ code: 'CONFLICT' });
    });
    it('denies a non-admin from creating a number', async () => {
      await expect(new Phase3Api(db, AGENT_EMAIL).createNumber({ displayName: 'X', phoneNumber: '079-485-09999', provider: 'exotel' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('Phase4Api — webhook ingestion', () => {
    it('creates a new customer, conversation, and message for a brand-new inbound message', async () => {
      const result = await new Phase4Api(db).ingestInboundMessage({
        providerMessageId: 'msg-1', fromPhone: '+919876543210', providerNumberId: '+917948502801',
        direction: 'INBOUND', messageType: 'text', text: 'Hello', timestamp: new Date().toISOString(), status: null,
      });
      expect(result.duplicate).toBe(false);
      expect(result.conversationId).toBeTruthy();

      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(result.conversationId!);
      expect(detail.customer?.phone).toBe('+919876543210');
      expect(detail.messages).toHaveLength(1);
      expect(detail.messages[0]!.messageText).toBe('Hello');
      expect(detail.conversation.needsResponse).toBe(true);
    });

    it('reuses the same OPEN conversation for a second message from the same customer', async () => {
      const first = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-1', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null });
      const second = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-2', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Again', timestamp: new Date().toISOString(), status: null });
      expect(second.conversationId).toBe(first.conversationId);
    });

    it('is idempotent on a duplicate providerMessageId', async () => {
      await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-1', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null });
      const dup = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-1', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null });
      expect(dup.duplicate).toBe(true);
    });

    it('rejects a message for an unregistered number', async () => {
      await expect(new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-x', fromPhone: '+919876543210', providerNumberId: '+910000000000', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('applies a status update to an existing message instead of creating a new one', async () => {
      const ingested = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-1', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null });
      const update = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-1', fromPhone: null, providerNumberId: null, direction: null, messageType: null, text: null, timestamp: new Date().toISOString(), status: 'DELIVERED' });
      expect(update.statusUpdate).toBe(true);
      expect(update.applied).toBe(true);
      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(ingested.conversationId!);
      expect(detail.messages[0]!.status).toBe('DELIVERED');
    });
  });

  describe('Phase5Api — authorized conversation listing', () => {
    let conversationId: string;
    beforeEach(async () => {
      const result = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-1', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null });
      conversationId = result.conversationId!;
    });

    it('an unassigned agent with number access cannot view a conversation not assigned to them', async () => {
      await expect(new Phase5Api(db, AGENT_EMAIL).getConversationDetail(conversationId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('ADMIN can view any conversation on a number they administer', async () => {
      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(conversationId);
      expect(detail.conversation.id).toBe(conversationId);
    });

    it('rejects listing conversations for a number the caller has no access to', async () => {
      await expect(new Phase5Api(db, AGENT_EMAIL).listConversations('some-other-number')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('listMyNumbers only returns numbers the agent has been granted', async () => {
      const other = await new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'Other', phoneNumber: '079-485-09999', provider: 'exotel' });
      const numbers = await new Phase5Api(db, AGENT_EMAIL).listMyNumbers();
      expect(numbers.map((n) => n.id)).toEqual([numberId]);
      expect(numbers.map((n) => n.id)).not.toContain(other.id);
    });
  });

  describe('Phase6Api — sendReply / resolveConversation', () => {
    let conversationId: string;
    beforeEach(async () => {
      const result = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-1', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null });
      conversationId = result.conversationId!;
      // Assign to the agent so 'reply' authorization passes (no round-robin ported yet — assign directly for this test).
      await db.put(`webapp_conversations/${conversationId}`, { ...(await db.get(`webapp_conversations/${conversationId}`) as object), assignedUserId: agentId });
    });

    it('sends a reply, records it as SENT, and clears needsResponse', async () => {
      const message = await new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendReply(conversationId, 'On it!');
      expect(message.status).toBe('SENT');
      expect(message.direction).toBe('OUTBOUND');
      expect(mock.exotelCalls).toHaveLength(1);
      expect(mock.exotelCalls[0]!.path).toBe('messages');

      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(conversationId);
      expect(detail.conversation.needsResponse).toBe(false);
      expect(detail.messages).toHaveLength(2);
    });

    it('still saves the message with FAILED status if the provider call fails, and does not throw', async () => {
      mock.setNextExotelResponse(500, { error: 'boom' });
      const message = await new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendReply(conversationId, 'On it!');
      expect(message.status).toBe('FAILED');
      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(conversationId);
      expect(detail.conversation.needsResponse).toBe(true); // unchanged — only a SENT message clears it
    });

    it('denies an agent replying to a conversation not assigned to them', async () => {
      const otherAgent = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: 'other-agent@example.com', displayName: 'Other', roleIds: [] });
      await new Phase1Api(db, ADMIN_EMAIL).grantNumberAccess({ userId: otherAgent.id, numberId });
      await expect(new Phase6Api(db, 'other-agent@example.com', mock.exotelConfig as never).sendReply(conversationId, 'Hi')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('resolveConversation closes the conversation', async () => {
      const record = await new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).resolveConversation(conversationId);
      expect(record.status).toBe('CLOSED');
    });
  });

  describe('WorkspaceApi — aggregator', () => {
    it('returns conversation + customer + number + messages with sender names, and a realtime token only when asked', async () => {
      const result = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-1', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null });
      const env = { FIREBASE_WEB_API_KEY: 'test-web-api-key' };

      const withoutRealtime = await new WorkspaceApi(db, ADMIN_EMAIL, env).getConversationWorkspace(result.conversationId!, false);
      expect(withoutRealtime.customer?.phone).toBe('+919876543210');
      expect(withoutRealtime.messages).toHaveLength(1);
      expect(withoutRealtime.realtime).toBeUndefined();

      const withRealtime = await new WorkspaceApi(db, ADMIN_EMAIL, env).getConversationWorkspace(result.conversationId!, true);
      expect(withRealtime.realtime?.token.split('.')).toHaveLength(3); // a real (mock-signed) JWT shape
      expect(withRealtime.realtime?.webApiKey).toBe('test-web-api-key');
    });
  });

  describe('ExotelProvider.processWebhook — real confirmed payload shape', () => {
    it('parses a real inbound-message webhook payload correctly', () => {
      const normalized = new ExotelProvider(mock.exotelConfig).processWebhook({
        whatsapp: { messages: [{ callback_type: 'incoming_message', sid: 'SM123', from: '+919876543210', to: '+917948502801', timestamp: '2026-01-01T00:00:00.000Z', profile_name: 'Test User', content: { type: 'text', text: { body: 'Hello' } } }] },
      });
      expect(normalized).toMatchObject({ providerMessageId: 'SM123', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', text: 'Hello', profileName: 'Test User' });
    });
  });
});

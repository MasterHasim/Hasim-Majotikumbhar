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

    it('sets lastCustomerMessageAt (the 24h-window anchor) on both new and reused conversations, distinct from lastMessageAt', async () => {
      const inbound = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-1', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: '2026-01-01T00:00:00.000Z', status: null });
      let record = (await db.get(`webapp_conversations/${inbound.conversationId}`)) as { lastCustomerMessageAt?: string };
      expect(record.lastCustomerMessageAt).toBe('2026-01-01T00:00:00.000Z');

      await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-2', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Again', timestamp: '2026-01-02T00:00:00.000Z', status: null });
      record = (await db.get(`webapp_conversations/${inbound.conversationId}`)) as { lastCustomerMessageAt?: string };
      expect(record.lastCustomerMessageAt).toBe('2026-01-02T00:00:00.000Z');
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

    it('orders messages by actual chronological time, not by comparing timestamp strings — outbound timestamps are UTC ("...Z") but Exotel\'s real inbound webhooks use a local offset ("...+05:30"), which sorts wrong as plain strings', async () => {
      // Outbound message stamped 10:00 UTC (how Ids.now() always formats it).
      const first = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-out', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'first (10:00 UTC)', timestamp: '2026-01-01T10:00:00.000Z', status: null });
      const conversationId = first.conversationId!;
      const outboundRecord = (await db.get(`webapp_messages/${first.messageId}`)) as Record<string, unknown>;
      await db.put(`webapp_messages/${first.messageId}`, { ...outboundRecord, direction: 'OUTBOUND', messageText: 'first (10:00 UTC)' });

      // Real inbound reply at 15:00 IST (+05:30) = 09:30 UTC — chronologically EARLIER than the
      // message above, even though "15:00:00+05:30" > "10:00:00.000Z" as a raw string.
      await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-in', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'second (09:30 UTC really)', timestamp: '2026-01-01T15:00:00+05:30', status: null });

      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(conversationId);
      expect(detail.messages.map((m) => m.messageText)).toEqual(['second (09:30 UTC really)', 'first (10:00 UTC)']);
    });

    it('listConversations does not write a fresh audit entry per conversation — real bug, confirmed live 2026-08-23: AccessControl.currentUser() wrote an "authentication.accepted" audit entry (2 subrequests) on every call, and requireConversationOperation calls currentUser() once per conversation while filtering visibility, so a number with 40+ conversations blew through Cloudflare\'s subrequest limit ("INTERNAL_ERROR: Too many subrequests") on this endpoint alone', async () => {
      for (let i = 0; i < 15; i++) {
        await new Phase4Api(db).ingestInboundMessage({ providerMessageId: `msg-bulk-${i}`, fromPhone: `+9198765${String(i).padStart(5, '0')}`, providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null });
      }
      const before = (await new Phase1Api(db, ADMIN_EMAIL).listAuditLog()).filter((e) => e.action === 'authentication.accepted').length;
      const conversations = await new Phase5Api(db, ADMIN_EMAIL).listConversations(numberId);
      expect(conversations.length).toBeGreaterThanOrEqual(15);
      const after = (await new Phase1Api(db, ADMIN_EMAIL).listAuditLog()).filter((e) => e.action === 'authentication.accepted').length;
      // Without the fix this would scale with conversation count (15+); with the fix, one
      // AccessControl instance writes the acceptance entry at most once no matter how many
      // times currentUser() is called internally within that single request.
      expect(after - before).toBeLessThanOrEqual(3);
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

  describe('Phase6Api — startNewConversation (ad-hoc, number not yet in the CRM)', () => {
    it('creates a new customer and conversation, assigns it to the caller, and reuses the same OPEN conversation on a second call', async () => {
      const result = await new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).startNewConversation(numberId, '+91 98765-00099', 'Walk-in');
      expect(result.numberId).toBe(numberId);
      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(result.conversationId);
      expect(detail.customer?.phone).toBe('+919876500099');
      expect(detail.customer?.name).toBe('Walk-in');
      expect(detail.conversation.assignedUserId).toBe(agentId);
      expect(detail.conversation.lastCustomerMessageAt).toBeUndefined(); // never had a real inbound message — first send must go through a template

      const again = await new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).startNewConversation(numberId, '+919876500099');
      expect(again.conversationId).toBe(result.conversationId);
      expect(again.customerId).toBe(result.customerId);
    });

    it('finds the existing customer by phone rather than creating a duplicate, if one already exists', async () => {
      const inbound = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-1', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null });
      const result = await new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).startNewConversation(numberId, '+919876543210');
      expect(result.customerId).not.toBe(result.conversationId); // sanity
      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(inbound.conversationId!);
      expect(result.customerId).toBe(detail.customer!.id);
    });

    it('rejects an invalid phone number', async () => {
      await expect(new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).startNewConversation(numberId, '123')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('denies an agent without access to the chosen number, but allows ADMIN regardless', async () => {
      const otherNumber = await new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'No Access', phoneNumber: '079-485-09998', provider: 'exotel' });
      await expect(new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).startNewConversation(otherNumber.id, '+919876500098')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(new Phase6Api(db, ADMIN_EMAIL, mock.exotelConfig as never).startNewConversation(otherNumber.id, '+919876500098')).resolves.toMatchObject({ numberId: otherNumber.id });
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

    it('parses a real delivery-status (dlr) callback as a status update, not an inbound message — same messages[] array shape as inbound, but "to" here is the customer, not our own number', () => {
      const normalized = new ExotelProvider(mock.exotelConfig).processWebhook({
        whatsapp: { messages: [{ callback_type: 'dlr', sid: 'SM123', to: '+918490903043', exo_status_code: 30001, exo_detailed_status: 'EX_MESSAGE_SENT', description: 'Message Sent', timestamp: '2026-08-23T00:13:07+05:30' }] },
      } as never);
      expect(normalized).toMatchObject({ providerMessageId: 'SM123', direction: null, providerNumberId: null, status: 'SENT' });
    });

    it('maps EX_MEDIA_UPLOAD_ERROR (30017) to FAILED', () => {
      const normalized = new ExotelProvider(mock.exotelConfig).processWebhook({
        whatsapp: { messages: [{ callback_type: 'dlr', sid: 'SM456', to: '+918490903043', exo_status_code: 30017, exo_detailed_status: 'EX_MEDIA_UPLOAD_ERROR', description: 'Media error_type not supported', timestamp: '2026-08-23T00:08:38+05:30' }] },
      } as never);
      expect(normalized.status).toBe('FAILED');
    });

    it('sendReply extracts providerMessageId from the real confirmed send-response envelope — real bug, confirmed live 2026-08-23: every response shape this code checked before missed the real one (everything wrapped under "response.whatsapp", each message\'s id nested under "data.sid"), so providerMessageId was empty on every single message ever sent, and the dlr status-update handler could never find a match', async () => {
      const inbound = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-seed-real-shape', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null });
      mock.setNextExotelResponse(200, { request_id: 'req-1', method: 'POST', http_code: 202, metadata: { failed: 0, total: 1, success: 1 }, response: { whatsapp: { messages: [{ code: 202, error_data: null, status: 'success', data: { sid: 'real-shape-sid-123' } }] } } });
      const sent = await new Phase6Api(db, ADMIN_EMAIL, mock.exotelConfig as never).sendReply(inbound.conversationId!, 'Hello');
      expect(sent.providerMessageId).toBe('real-shape-sid-123');
    });

    it('a dlr callback applies as a status update via ingestInboundMessage instead of failing with "No registered number matches"', async () => {
      const inbound = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-seed', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null });
      const sent = await new Phase6Api(db, ADMIN_EMAIL, mock.exotelConfig as never).sendReply(inbound.conversationId!, 'Outbound text');
      const providerMessageId = (await db.get(`webapp_messages/${sent.id}`) as { providerMessageId: string }).providerMessageId;
      const normalized = new ExotelProvider(mock.exotelConfig).processWebhook({
        whatsapp: { messages: [{ callback_type: 'dlr', sid: providerMessageId, to: '+919876543210', exo_status_code: 30002, exo_detailed_status: 'EX_MESSAGE_DELIVERED', description: 'Delivered', timestamp: new Date().toISOString() }] },
      } as never);
      const result = await new Phase4Api(db).ingestInboundMessage(normalized);
      expect(result).toMatchObject({ statusUpdate: true, applied: true, status: 'DELIVERED' });
      expect((await db.get(`webapp_messages/${sent.id}`) as { status: string }).status).toBe('DELIVERED');
    });
  });
});

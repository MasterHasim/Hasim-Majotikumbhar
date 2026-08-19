import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { Phase3Api } from '../src/services/phase3Api';
import { Phase4Api } from '../src/services/phase4Api';
import { Phase6Api } from '../src/services/phase6Api';
import { Phase7Api } from '../src/services/phase7Api';
import { Phase8Api } from '../src/services/phase8Api';
import { Phase13Api } from '../src/services/phase13Api';
import { Roles } from '../src/domain/phase1';

const ADMIN_EMAIL = 'admin@example.com';
const AGENT_EMAIL = 'agent@example.com';

describe('Phase13Api (ported from Phase13Services.gs)', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;
  let agentId: string;
  let numberId: string;

  beforeEach(async () => {
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);

    await new Phase1Api(db, ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, ADMIN_EMAIL);
    const roles = await new Phase1Api(db, ADMIN_EMAIL).listRoles();
    const agentRoleId = roles.find((r) => r.key === Roles.AGENT)!.id;
    const agent = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: AGENT_EMAIL, displayName: 'Agent', roleIds: [] });
    agentId = agent.id;
    await new Phase1Api(db, ADMIN_EMAIL).updateUser(agentId, { roleIds: [agentRoleId] });

    const number = await new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'Test Number', phoneNumber: '079-485-02801', provider: 'exotel' });
    numberId = number.id;
    await new Phase1Api(db, ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId });
  });

  afterEach(() => mock.restore());

  async function ingest(providerMessageId: string, fromPhone: string, profileName: string, text: string) {
    return new Phase4Api(db).ingestInboundMessage({
      providerMessageId, fromPhone, providerNumberId: '+917948502801',
      direction: 'INBOUND', messageType: 'text', text, timestamp: new Date().toISOString(), status: null,
      profileName,
    });
  }

  describe('searchConversations', () => {
    it('defaults to OPEN-only across every number the caller can access', async () => {
      const opened = await ingest('msg-1', '+919876543210', 'Priya', 'Hello');
      const closedResult = await ingest('msg-2', '+919876543211', 'Ravi', 'Hi there');
      await new Phase6Api(db, ADMIN_EMAIL, mock.exotelConfig as never).resolveConversation(closedResult.conversationId!);

      const results = await new Phase13Api(db, ADMIN_EMAIL).searchConversations();
      expect(results.map((r) => r.id)).toEqual([opened.conversationId]);
      expect(results[0]!.numberDisplayName).toBe('Test Number');
    });

    it('status: ANY returns every status', async () => {
      const first = await ingest('msg-1', '+919876543210', 'Priya', 'Hello');
      await new Phase6Api(db, ADMIN_EMAIL, mock.exotelConfig as never).resolveConversation(first.conversationId!);
      const results = await new Phase13Api(db, ADMIN_EMAIL).searchConversations({ status: 'ANY' });
      expect(results.map((r) => r.id)).toContain(first.conversationId);
      expect(results.find((r) => r.id === first.conversationId)!.status).toBe('CLOSED');
    });

    it('filters by needsResponse and unassigned', async () => {
      const result = await ingest('msg-1', '+919876543210', 'Priya', 'Hello');
      const needsResponse = await new Phase13Api(db, ADMIN_EMAIL).searchConversations({ needsResponse: true });
      expect(needsResponse.map((r) => r.id)).toContain(result.conversationId);

      const unassigned = await new Phase13Api(db, ADMIN_EMAIL).searchConversations({ unassigned: true });
      expect(unassigned.map((r) => r.id)).toContain(result.conversationId);

      await new Phase7Api(db, ADMIN_EMAIL).reassignConversation(result.conversationId!, agentId);
      const stillUnassigned = await new Phase13Api(db, ADMIN_EMAIL).searchConversations({ unassigned: true });
      expect(stillUnassigned.map((r) => r.id)).not.toContain(result.conversationId);
    });

    it('filters by assignedUserId and by stageId', async () => {
      const result = await ingest('msg-1', '+919876543210', 'Priya', 'Hello');
      await new Phase7Api(db, ADMIN_EMAIL).reassignConversation(result.conversationId!, agentId);

      const byAssignee = await new Phase13Api(db, ADMIN_EMAIL).searchConversations({ assignedUserId: agentId });
      expect(byAssignee.map((r) => r.id)).toContain(result.conversationId);

      const stages = await new Phase8Api(db, ADMIN_EMAIL).seedDefaultLeadStages();
      await new Phase8Api(db, ADMIN_EMAIL).setCustomerStage(result.customerId!, stages[0]!.id);

      const byStage = await new Phase13Api(db, ADMIN_EMAIL).searchConversations({ stageId: stages[0]!.id });
      expect(byStage.map((r) => r.id)).toContain(result.conversationId);
      const byOtherStage = await new Phase13Api(db, ADMIN_EMAIL).searchConversations({ stageId: stages[1]!.id });
      expect(byOtherStage.map((r) => r.id)).not.toContain(result.conversationId);
    });

    it('query matches customer name/phone or message text, case-insensitively', async () => {
      const byName = await ingest('msg-1', '+919876543210', 'Priya Sharma', 'Hello there');
      const byMessage = await ingest('msg-2', '+919876543299', 'Anonymous', 'I need help with billing');

      const nameMatch = await new Phase13Api(db, ADMIN_EMAIL).searchConversations({ query: 'priya' });
      expect(nameMatch.map((r) => r.id)).toEqual([byName.conversationId]);

      const phoneMatch = await new Phase13Api(db, ADMIN_EMAIL).searchConversations({ query: '9876543299' });
      expect(phoneMatch.map((r) => r.id)).toEqual([byMessage.conversationId]);

      const textMatch = await new Phase13Api(db, ADMIN_EMAIL).searchConversations({ query: 'billing' });
      expect(textMatch.map((r) => r.id)).toEqual([byMessage.conversationId]);
    });

    it('an agent only sees conversations they are authorized to view (delegates to Phase5Api)', async () => {
      const result = await ingest('msg-1', '+919876543210', 'Priya', 'Hello');
      const denied = await new Phase13Api(db, AGENT_EMAIL).searchConversations();
      expect(denied.map((r) => r.id)).not.toContain(result.conversationId);

      await new Phase7Api(db, ADMIN_EMAIL).reassignConversation(result.conversationId!, agentId);
      const visible = await new Phase13Api(db, AGENT_EMAIL).searchConversations();
      expect(visible.map((r) => r.id)).toContain(result.conversationId);
    });
  });

  describe('getNeedsResponseCounts', () => {
    it('counts open, needs-response conversations per number the caller can access', async () => {
      await ingest('msg-1', '+919876543210', 'Priya', 'Hello');
      await ingest('msg-2', '+919876543211', 'Ravi', 'Hi');
      const counts = await new Phase13Api(db, ADMIN_EMAIL).getNeedsResponseCounts();
      expect(counts[numberId]).toBe(2);
    });

    it('a reply clears needsResponse and the count drops', async () => {
      const result = await ingest('msg-1', '+919876543210', 'Priya', 'Hello');
      await new Phase7Api(db, ADMIN_EMAIL).reassignConversation(result.conversationId!, agentId);
      await new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendReply(result.conversationId!, 'On it!');
      const counts = await new Phase13Api(db, ADMIN_EMAIL).getNeedsResponseCounts();
      expect(counts[numberId]).toBe(0);
    });
  });
});

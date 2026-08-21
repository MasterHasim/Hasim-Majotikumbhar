import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { Phase3Api } from '../src/services/phase3Api';
import { Phase4Api } from '../src/services/phase4Api';
import { Phase6Api } from '../src/services/phase6Api';
import { Phase7Api } from '../src/services/phase7Api';
import { Phase8Api } from '../src/services/phase8Api';
import { Phase14Api } from '../src/services/phase14Api';
import { Roles } from '../src/domain/phase1';

const ADMIN_EMAIL = 'admin@example.com';
const AGENT_EMAIL = 'agent@example.com';

describe('Phase14Api (ported from Phase14Services.gs)', () => {
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

  async function ingest(providerMessageId: string, fromPhone: string) {
    return new Phase4Api(db).ingestInboundMessage({
      providerMessageId, fromPhone, providerNumberId: '+917948502801',
      direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null,
    });
  }

  it('denies AGENT (no REPORTS_VIEW) but allows ADMIN', async () => {
    await expect(new Phase14Api(db, AGENT_EMAIL).getDashboardMetrics()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(new Phase14Api(db, ADMIN_EMAIL).getDashboardMetrics()).resolves.toBeTruthy();
  });

  it('summarizes conversations by status across every number the caller can access', async () => {
    await ingest('msg-1', '+919876543210');
    const resolved = await ingest('msg-2', '+919876543211');
    await new Phase6Api(db, ADMIN_EMAIL, mock.exotelConfig as never).resolveConversation(resolved.conversationId!);

    const metrics = await new Phase14Api(db, ADMIN_EMAIL).getDashboardMetrics();
    expect(metrics.conversations).toMatchObject({ total: 2, open: 1, resolved: 1, unassigned: 1, needsResponse: 1 });
    expect(metrics.totalCustomers).toBe(2);
    expect(metrics.byNumber).toHaveLength(1);
    expect(metrics.byNumber[0]).toMatchObject({ numberId, displayName: 'Test Number', total: 2 });
  });

  it('narrows to a single number when numberId is passed, without bypassing access', async () => {
    await ingest('msg-1', '+919876543210');
    const other = await new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'Other Number', phoneNumber: '079-485-09999', provider: 'exotel' });
    const scoped = await new Phase14Api(db, ADMIN_EMAIL).getDashboardMetrics(numberId);
    expect(scoped.byNumber).toHaveLength(1);
    expect(scoped.byNumber[0]!.numberId).toBe(numberId);

    // An admin requesting a number they administer but with zero data just gets empty metrics, not an error.
    const emptyOther = await new Phase14Api(db, ADMIN_EMAIL).getDashboardMetrics(other.id);
    expect(emptyOther.conversations.total).toBe(0);
  });

  it('counts assignedToMe (scoped to the caller) and byAgent for OPEN conversations only', async () => {
    const result = await ingest('msg-1', '+919876543210');
    await new Phase7Api(db, ADMIN_EMAIL).reassignConversation(result.conversationId!, agentId);

    const metrics = await new Phase14Api(db, ADMIN_EMAIL).getDashboardMetrics();
    expect(metrics.byAgent).toEqual([{ userId: agentId, displayName: 'Agent', open: 1, needsResponse: 1 }]);
    // assignedToMe is scoped to the CALLER's own id (ADMIN here), not the agent's.
    expect(metrics.assignedToMe).toBe(0);
  });

  it('computes average first-response time from OUTBOUND messages', async () => {
    const result = await ingest('msg-1', '+919876543210');
    await new Phase7Api(db, ADMIN_EMAIL).reassignConversation(result.conversationId!, agentId);
    await new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendReply(result.conversationId!, 'On it!');

    const metrics = await new Phase14Api(db, ADMIN_EMAIL).getDashboardMetrics();
    expect(metrics.responseTime.sampleSize).toBe(1);
    expect(metrics.responseTime.averageFirstResponseMinutes).not.toBeNull();
    expect(metrics.responseTime.averageFirstResponseMinutes!).toBeGreaterThanOrEqual(0);
  });

  it('computes stage distribution and lead conversion from CustomerStage records', async () => {
    const stages = await new Phase8Api(db, ADMIN_EMAIL).seedDefaultLeadStages();
    const wonStage = stages.find((s) => s.key === 'lead_won')!;
    const result = await ingest('msg-1', '+919876543210');
    await new Phase6Api(db, ADMIN_EMAIL, mock.exotelConfig as never).resolveConversation(result.conversationId!);
    await new Phase8Api(db, ADMIN_EMAIL).setCustomerStage(result.customerId!, wonStage.id);

    const metrics = await new Phase14Api(db, ADMIN_EMAIL).getDashboardMetrics();
    expect(metrics.stageDistribution.find((s) => s.stageId === wonStage.id)?.count).toBe(1);
    expect(metrics.leadConversion).toEqual({ totalCustomersWithStage: 1, wonCount: 1, conversionRate: 100 });
  });

  it('parses template usage from the "[Template: name]" display-text marker', async () => {
    const result = await ingest('msg-1', '+919876543210');
    await new Phase7Api(db, ADMIN_EMAIL).reassignConversation(result.conversationId!, agentId);
    // Directly write a template-type message the same way Phase6Api.sendTemplateReply would, to avoid needing a real APPROVED template fixture here.
    await db.put(`webapp_messages/msg_template_1`, {
      id: 'msg_template_1', conversationId: result.conversationId, numberId, senderUserId: agentId,
      direction: 'OUTBOUND', messageType: 'template', messageText: '[Template: welcome]', providerMessageId: '', status: 'SENT', timestamp: new Date().toISOString(),
    });

    const metrics = await new Phase14Api(db, ADMIN_EMAIL).getDashboardMetrics();
    expect(metrics.templateUsage).toEqual([{ name: 'welcome', count: 1 }]);
  });
});

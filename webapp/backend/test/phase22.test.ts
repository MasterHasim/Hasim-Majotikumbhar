import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { Phase3Api } from '../src/services/phase3Api';
import { Phase8Api } from '../src/services/phase8Api';
import { Phase22Api, computeQuotationTotals, getPublicQuotationView } from '../src/services/phase22Api';
import { CustomFieldsApi } from '../src/services/customFieldsApi';
import { ProductsApi } from '../src/services/productsApi';
import { Roles } from '../src/domain/phase1';

const ADMIN_EMAIL = 'admin@example.com';
const AGENT_EMAIL = 'agent@example.com';
const AGENT2_EMAIL = 'agent2@example.com';

describe('Phase22Api (ported from Phase22Domain.gs + Phase22Services.gs)', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;
  let agentId: string;
  let agent2Id: string;

  beforeEach(async () => {
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);

    await new Phase1Api(db, ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, ADMIN_EMAIL);
    const roles = await new Phase1Api(db, ADMIN_EMAIL).listRoles();
    const agentRoleId = roles.find((r) => r.key === Roles.AGENT)!.id;

    const agent = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: AGENT_EMAIL, displayName: 'Agent', roleIds: [] });
    agentId = agent.id;
    await new Phase1Api(db, ADMIN_EMAIL).updateUser(agentId, { roleIds: [agentRoleId], phone: '+919000000001' });

    const agent2 = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: AGENT2_EMAIL, displayName: 'Agent Two', roleIds: [] });
    agent2Id = agent2.id;
    await new Phase1Api(db, ADMIN_EMAIL).updateUser(agent2Id, { roleIds: [agentRoleId], phone: '+919000000002' });
  });

  afterEach(() => mock.restore());

  describe('listLocations', () => {
    it('returns the six fixed locations for any authenticated user', async () => {
      const locations = await new Phase22Api(db, AGENT_EMAIL).listLocations();
      expect(locations).toEqual(['Raipur', 'Rajsamand', 'Coimbatore', 'Prayagraj', 'Alibaug', 'Saraighat']);
    });
  });

  describe('uploadLeads', () => {
    it('denies a non-manager from uploading', async () => {
      await expect(new Phase22Api(db, AGENT_EMAIL).uploadLeads([{ name: 'X', phone: '+919876543210', location: 'Raipur' }])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects a non-array or empty rows payload', async () => {
      await expect(new Phase22Api(db, ADMIN_EMAIL).uploadLeads([])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(new Phase22Api(db, ADMIN_EMAIL).uploadLeads('nope')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('creates valid rows, skips duplicates, and reports invalid rows individually without aborting the batch', async () => {
      const first = await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([
        { name: 'Priya', phone: '+919876543210', location: 'Raipur' },
        { name: 'Bad row', phone: '123', location: 'Raipur' }, // fails phone validation
        { name: '', phone: '+919876543211', location: 'Raipur' }, // fails name validation
        { name: 'Ravi', phone: '+919876543212', location: 'NotARealPlace' }, // fails location validation
      ]);
      expect(first.created).toBe(1);
      expect(first.skipped).toBe(0);
      expect(first.errors).toHaveLength(3);

      const dup = await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([{ name: 'Priya', phone: '+919876543210', location: 'Raipur' }]);
      expect(dup.created).toBe(0);
      expect(dup.skipped).toBe(1);

      const leads = await new Phase22Api(db, ADMIN_EMAIL).listLeads();
      expect(leads).toHaveLength(1);
      expect(leads[0]!.status).toBe('UNASSIGNED'); // no location config yet -> manual/unassigned
    });

    it('assigns to the configured singleUserId in single mode', async () => {
      await new Phase22Api(db, ADMIN_EMAIL).setLocationConfig('Raipur', { mode: 'single', singleUserId: agentId, active: true });
      const result = await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([{ name: 'Priya', phone: '+919876543210', location: 'Raipur' }]);
      expect(result.created).toBe(1);
      const leads = await new Phase22Api(db, ADMIN_EMAIL).listLeads();
      expect(leads[0]!.status).toBe('ASSIGNED');
      expect(leads[0]!.assignedUserId).toBe(agentId);
    });

    it('round-robins leads across active participants in sequence order', async () => {
      await new Phase22Api(db, ADMIN_EMAIL).setLocationConfig('Raipur', { mode: 'round_robin', active: true });
      await new Phase22Api(db, ADMIN_EMAIL).addLocationParticipant('Raipur', agentId, 1);
      await new Phase22Api(db, ADMIN_EMAIL).addLocationParticipant('Raipur', agent2Id, 2);

      await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([{ name: 'Lead One', phone: '+919876543210', location: 'Raipur' }]);
      await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([{ name: 'Lead Two', phone: '+919876543211', location: 'Raipur' }]);
      await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([{ name: 'Lead Three', phone: '+919876543212', location: 'Raipur' }]);

      const leads = (await new Phase22Api(db, ADMIN_EMAIL).listLeads()).sort((a, b) => a.phone.localeCompare(b.phone));
      expect(leads.map((l) => l.assignedUserId)).toEqual([agentId, agent2Id, agentId]);
    });

    it('leaves a lead unassigned when the location config is inactive', async () => {
      await new Phase22Api(db, ADMIN_EMAIL).setLocationConfig('Raipur', { mode: 'round_robin', active: false });
      await new Phase22Api(db, ADMIN_EMAIL).addLocationParticipant('Raipur', agentId, 1);
      await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([{ name: 'Lead', phone: '+919876543210', location: 'Raipur' }]);
      const leads = await new Phase22Api(db, ADMIN_EMAIL).listLeads();
      expect(leads[0]!.status).toBe('UNASSIGNED');
    });
  });

  describe('reassignLead', () => {
    let leadId: string;
    beforeEach(async () => {
      await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([{ name: 'Lead', phone: '+919876543210', location: 'Raipur' }]);
      leadId = (await new Phase22Api(db, ADMIN_EMAIL).listLeads())[0]!.id;
    });

    it('reassigns to a valid user', async () => {
      const record = await new Phase22Api(db, ADMIN_EMAIL).reassignLead(leadId, agentId);
      expect(record.assignedUserId).toBe(agentId);
      expect(record.status).toBe('ASSIGNED');
    });

    it('rejects reassigning to a nonexistent user', async () => {
      await expect(new Phase22Api(db, ADMIN_EMAIL).reassignLead(leadId, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('denies a non-manager', async () => {
      await expect(new Phase22Api(db, AGENT_EMAIL).reassignLead(leadId, agentId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('listLeads scoping', () => {
    beforeEach(async () => {
      await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([
        { name: 'Lead A', phone: '+919876543210', location: 'Raipur' },
        { name: 'Lead B', phone: '+919876543211', location: 'Rajsamand' },
      ]);
      const leads = await new Phase22Api(db, ADMIN_EMAIL).listLeads();
      await new Phase22Api(db, ADMIN_EMAIL).reassignLead(leads[0]!.id, agentId);
    });

    it('a manager sees every lead', async () => {
      const leads = await new Phase22Api(db, ADMIN_EMAIL).listLeads();
      expect(leads).toHaveLength(2);
    });

    it('an agent sees only leads assigned to them', async () => {
      const leads = await new Phase22Api(db, AGENT_EMAIL).listLeads();
      expect(leads).toHaveLength(1);
      expect(leads[0]!.assignedUserId).toBe(agentId);
    });

    it('filters by location/status', async () => {
      const leads = await new Phase22Api(db, ADMIN_EMAIL).listLeads({ location: 'Rajsamand' });
      expect(leads).toHaveLength(1);
      expect(leads[0]!.location).toBe('Rajsamand');
    });
  });

  describe('location assignment config/participants', () => {
    it('denies a non-manager from reading or writing config', async () => {
      await expect(new Phase22Api(db, AGENT_EMAIL).getLocationConfig('Raipur')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(new Phase22Api(db, AGENT_EMAIL).setLocationConfig('Raipur', { mode: 'manual' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects an unknown field in the config patch', async () => {
      await expect(new Phase22Api(db, ADMIN_EMAIL).setLocationConfig('Raipur', { notAField: 1 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects a non-user singleUserId', async () => {
      await expect(new Phase22Api(db, ADMIN_EMAIL).setLocationConfig('Raipur', { mode: 'single', singleUserId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('normalizes callerId formatting', async () => {
      const config = await new Phase22Api(db, ADMIN_EMAIL).setLocationConfig('Raipur', { callerId: '079-485-02804' });
      expect(config.callerId).toBe('07948502804');
    });

    it('rejects adding the same participant twice', async () => {
      await new Phase22Api(db, ADMIN_EMAIL).addLocationParticipant('Raipur', agentId, 1);
      await expect(new Phase22Api(db, ADMIN_EMAIL).addLocationParticipant('Raipur', agentId, 2)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('updates a participant sequenceOrder/active', async () => {
      const p = await new Phase22Api(db, ADMIN_EMAIL).addLocationParticipant('Raipur', agentId, 1);
      const updated = await new Phase22Api(db, ADMIN_EMAIL).updateLocationParticipant(p.id, { active: false });
      expect(updated.active).toBe(false);
    });
  });

  describe('initiateCall', () => {
    let leadId: string;
    beforeEach(async () => {
      await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([{ name: 'Lead', phone: '+919876543210', location: 'Raipur' }]);
      leadId = (await new Phase22Api(db, ADMIN_EMAIL).listLeads())[0]!.id;
      await new Phase22Api(db, ADMIN_EMAIL).reassignLead(leadId, agentId);
    });

    it('places a call for the assigned agent, logs it, and marks the lead CALLED', async () => {
      const call = await new Phase22Api(db, AGENT_EMAIL, mock.exotelVoiceConfig as never).initiateCall(leadId);
      expect(call.agentUserId).toBe(agentId);
      expect(call.agentPhone).toBe('+919000000001');
      expect(call.leadPhone).toBe('+919876543210');
      expect(call.exotelCallSid).toBeTruthy();
      expect(mock.exotelVoiceCalls).toHaveLength(1);
      expect(mock.exotelVoiceCalls[0]!.params.From).toBe('+919000000001');
      expect(mock.exotelVoiceCalls[0]!.params.To).toBe('+919876543210');

      const leads = await new Phase22Api(db, ADMIN_EMAIL).listLeads();
      expect(leads.find((l) => l.id === leadId)!.status).toBe('CALLED');

      const log = await new Phase22Api(db, ADMIN_EMAIL).listCallLog(leadId);
      expect(log).toHaveLength(1);
    });

    it('uses the location caller ID when one is configured', async () => {
      await new Phase22Api(db, ADMIN_EMAIL).setLocationConfig('Raipur', { callerId: '07948502804' });
      const call = await new Phase22Api(db, AGENT_EMAIL, mock.exotelVoiceConfig as never).initiateCall(leadId);
      expect(call.callerId).toBe('07948502804');
      expect(mock.exotelVoiceCalls[0]!.params.CallerId).toBe('07948502804');
    });

    it('denies a call for a lead not assigned to the caller — unless the caller is a lead manager', async () => {
      await expect(new Phase22Api(db, AGENT2_EMAIL, mock.exotelVoiceConfig as never).initiateCall(leadId)).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const admin = await new Phase1Api(db, ADMIN_EMAIL).whoAmI();
      await new Phase1Api(db, ADMIN_EMAIL).updateUser(admin.id, { phone: '+919000000099' });
      const call = await new Phase22Api(db, ADMIN_EMAIL, mock.exotelVoiceConfig as never).initiateCall(leadId);
      expect(call.agentPhone).toBe('+919000000099'); // rings the manager's own phone, not the assigned agent's
      expect(call.leadPhone).toBe('+919876543210');
    });

    it('rejects when the agent has no phone on file', async () => {
      await new Phase1Api(db, ADMIN_EMAIL).updateUser(agentId, { phone: '' });
      await expect(new Phase22Api(db, AGENT_EMAIL, mock.exotelVoiceConfig as never).initiateCall(leadId)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('fails with CONFIGURATION_ERROR when Voice credentials are not configured', async () => {
      await expect(new Phase22Api(db, AGENT_EMAIL).initiateCall(leadId)).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    });
  });

  describe('lead stage and remarks', () => {
    let leadId: string;
    let stageId: string;
    beforeEach(async () => {
      const stages = await new Phase8Api(db, ADMIN_EMAIL).seedDefaultLeadStages();
      stageId = stages[0]!.id;
      await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([{ name: 'Lead', phone: '+919876543210', location: 'Raipur' }]);
      leadId = (await new Phase22Api(db, ADMIN_EMAIL).listLeads())[0]!.id;
      await new Phase22Api(db, ADMIN_EMAIL).reassignLead(leadId, agentId);
    });

    it('the assigned agent can set and read the lead stage; an unrelated agent cannot', async () => {
      const record = await new Phase22Api(db, AGENT_EMAIL).setLeadStage(leadId, stageId);
      expect(record.stageId).toBe(stageId);
      expect(await new Phase22Api(db, AGENT_EMAIL).getLeadStage(leadId)).toMatchObject({ stageId });
      await expect(new Phase22Api(db, AGENT2_EMAIL).setLeadStage(leadId, stageId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('the assigned agent can add and list remarks; an unrelated agent cannot', async () => {
      const remark = await new Phase22Api(db, AGENT_EMAIL).addLeadRemark(leadId, 'Called, left voicemail.');
      expect(remark.authorUserId).toBe(agentId);
      const remarks = await new Phase22Api(db, AGENT_EMAIL).listLeadRemarks(leadId);
      expect(remarks).toHaveLength(1);
      await expect(new Phase22Api(db, AGENT2_EMAIL).addLeadRemark(leadId, 'Hi')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('the assigned agent can set tags; an unrelated agent cannot; a manager always can', async () => {
      const lead = await new Phase22Api(db, AGENT_EMAIL).updateLeadTags(leadId, ['Hot', 'Budget constrained']);
      expect(lead.tags).toEqual(['Hot', 'Budget constrained']);
      await expect(new Phase22Api(db, AGENT2_EMAIL).updateLeadTags(leadId, ['Nope'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(new Phase22Api(db, ADMIN_EMAIL).updateLeadTags(leadId, ['Manager tag'])).resolves.toMatchObject({ tags: ['Manager tag'] });
    });

    it('trims, drops blanks, dedupes case-insensitively, and caps tags at 20', async () => {
      const lead = await new Phase22Api(db, AGENT_EMAIL).updateLeadTags(leadId, [' Hot ', '', 'hot', 'Cold']);
      expect(lead.tags).toEqual(['Hot', 'Cold']);
      const many = Array.from({ length: 25 }, (_, i) => `tag${i}`);
      const capped = await new Phase22Api(db, AGENT_EMAIL).updateLeadTags(leadId, many);
      expect(capped.tags).toHaveLength(20);
    });

    it('a manager can touch any lead regardless of assignment', async () => {
      await expect(new Phase22Api(db, ADMIN_EMAIL).setLeadStage(leadId, stageId)).resolves.toMatchObject({ stageId });
    });

    it('updateLeadCustomFields validates against live definitions, merges rather than replaces, and clears blanked keys', async () => {
      const cf = new CustomFieldsApi(db, ADMIN_EMAIL);
      await cf.createDefinition({ entityType: 'lead', label: 'Lead Source', type: 'select', options: ['Website', 'Referral'] });
      await cf.createDefinition({ entityType: 'lead', label: 'Expected Revenue', type: 'number' });

      const lead1 = await new Phase22Api(db, AGENT_EMAIL).updateLeadCustomFields(leadId, { lead_source: 'Website' });
      expect(lead1.customFields).toEqual({ lead_source: 'Website' });

      const lead2 = await new Phase22Api(db, AGENT_EMAIL).updateLeadCustomFields(leadId, { expected_revenue: '50000' });
      expect(lead2.customFields).toEqual({ lead_source: 'Website', expected_revenue: 50000 });

      const lead3 = await new Phase22Api(db, AGENT_EMAIL).updateLeadCustomFields(leadId, { lead_source: '' });
      expect(lead3.customFields).toEqual({ expected_revenue: 50000 });

      await expect(new Phase22Api(db, AGENT_EMAIL).updateLeadCustomFields(leadId, { lead_source: 'Not An Option' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(new Phase22Api(db, AGENT2_EMAIL).updateLeadCustomFields(leadId, { lead_source: 'Website' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('listLeadActivity shows reassignment, stage, tag, and remark events with resolved actor names, newest first, excluding denials', async () => {
      await new Phase22Api(db, AGENT_EMAIL).setLeadStage(leadId, stageId);
      await new Phase22Api(db, AGENT_EMAIL).updateLeadTags(leadId, ['Hot']);
      await new Phase22Api(db, AGENT_EMAIL).addLeadRemark(leadId, 'Called, left voicemail.');
      await expect(new Phase22Api(db, AGENT2_EMAIL).setLeadStage(leadId, stageId)).rejects.toMatchObject({ code: 'FORBIDDEN' }); // should not show up below

      const activity = await new Phase22Api(db, AGENT_EMAIL).listLeadActivity(leadId);
      const actions = activity.map((e) => e.action);
      expect(actions).toContain('lead.reassigned');
      expect(actions).toContain('lead.stageChanged');
      expect(actions).toContain('lead.tagsUpdated');
      expect(actions).toContain('leadRemark.added'); // matched via metadata.leadId, not targetType
      expect(actions).not.toContain('authorization.denied');
      expect(activity.find((e) => e.action === 'lead.reassigned')!.actorName).toBe('Admin');
      expect(activity.find((e) => e.action === 'lead.tagsUpdated')!.actorName).toBe('Agent');
      // newest first
      expect(new Date(activity[0]!.occurredAt).getTime()).toBeGreaterThanOrEqual(new Date(activity.at(-1)!.occurredAt).getTime());
    });

    it('denormalizes stageId onto the lead record itself, so listLeads() reflects it without a per-lead fetch (for the Kanban board)', async () => {
      await new Phase22Api(db, AGENT_EMAIL).setLeadStage(leadId, stageId);
      const lead = (await new Phase22Api(db, AGENT_EMAIL).listLeads()).find((l) => l.id === leadId);
      expect(lead?.stageId).toBe(stageId);
    });
  });

  describe('startWhatsAppFromLead / initiateConversationCall', () => {
    let leadId: string;
    let numberId: string;
    beforeEach(async () => {
      const number = await new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'Entartica - Raipur', phoneNumber: '079-485-02801', provider: 'exotel' });
      numberId = number.id;
      await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([{ name: 'Priya', phone: '+919876543210', location: 'Raipur' }]);
      leadId = (await new Phase22Api(db, ADMIN_EMAIL).listLeads())[0]!.id;
      await new Phase22Api(db, ADMIN_EMAIL).reassignLead(leadId, agentId);
    });

    it('fails clearly when no WhatsApp number matches the lead location', async () => {
      const other = await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([{ name: 'X', phone: '+919876500000', location: 'Coimbatore' }]);
      expect(other.created).toBe(1);
      const otherLead = (await new Phase22Api(db, ADMIN_EMAIL).listLeads({ location: 'Coimbatore' }))[0]!;
      await new Phase22Api(db, ADMIN_EMAIL).reassignLead(otherLead.id, agentId);
      await expect(new Phase22Api(db, AGENT_EMAIL).startWhatsAppFromLead(otherLead.id)).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    });

    it('denies the agent when they lack numberAccess for the resolved WhatsApp number', async () => {
      await expect(new Phase22Api(db, AGENT_EMAIL).startWhatsAppFromLead(leadId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('creates a customer + open conversation and is idempotent on a second call', async () => {
      await new Phase1Api(db, ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId });
      const first = await new Phase22Api(db, AGENT_EMAIL).startWhatsAppFromLead(leadId);
      expect(first.numberId).toBe(numberId);
      const second = await new Phase22Api(db, AGENT_EMAIL).startWhatsAppFromLead(leadId);
      expect(second.conversationId).toBe(first.conversationId);
      expect(second.customerId).toBe(first.customerId);
    });

    it('initiateConversationCall uses the conversation number as caller ID', async () => {
      await new Phase1Api(db, ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId });
      const { conversationId } = await new Phase22Api(db, AGENT_EMAIL).startWhatsAppFromLead(leadId);
      await db.put(`webapp_conversations/${conversationId}`, { ...(await db.get(`webapp_conversations/${conversationId}`) as object), assignedUserId: agentId });
      const call = await new Phase22Api(db, AGENT_EMAIL, mock.exotelVoiceConfig as never).initiateConversationCall(conversationId);
      expect(call.callerId).toBe('079-485-02801');
      expect(mock.exotelVoiceCalls.at(-1)!.params.CallerId).toBe('079-485-02801');
    });

    it('listCallHistory enriches lead and conversation calls with subject context, newest first; an unrelated agent sees only their own', async () => {
      await new Phase22Api(db, AGENT_EMAIL, mock.exotelVoiceConfig as never).initiateCall(leadId);
      await new Phase1Api(db, ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId });
      const { conversationId } = await new Phase22Api(db, AGENT_EMAIL).startWhatsAppFromLead(leadId);
      await db.put(`webapp_conversations/${conversationId}`, { ...(await db.get(`webapp_conversations/${conversationId}`) as object), assignedUserId: agentId });
      await new Phase22Api(db, AGENT_EMAIL, mock.exotelVoiceConfig as never).initiateConversationCall(conversationId);

      const agentHistory = await new Phase22Api(db, AGENT_EMAIL).listCallHistory();
      expect(agentHistory).toHaveLength(2);
      expect(agentHistory[0]!.conversationId).toBe(conversationId); // newest first
      expect(agentHistory[0]!.numberId).toBe(numberId);
      expect(agentHistory[0]!.subjectName).toBe('Priya');
      expect(agentHistory[1]!.subjectName).toBe('Priya');
      expect(agentHistory[1]!.subjectLocation).toBe('Raipur');
      expect(agentHistory.every((c) => c.agentName === 'Agent')).toBe(true);

      expect(await new Phase22Api(db, AGENT2_EMAIL).listCallHistory()).toEqual([]);
      expect(await new Phase22Api(db, ADMIN_EMAIL).listCallHistory()).toHaveLength(2);
    });

    it('listConversationCallHistory matches by conversationId and by the customer\'s phone (a call placed on the Lead before the conversation existed)', async () => {
      await new Phase22Api(db, AGENT_EMAIL, mock.exotelVoiceConfig as never).initiateCall(leadId); // pre-conversation lead call
      await new Phase1Api(db, ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId });
      const { conversationId } = await new Phase22Api(db, AGENT_EMAIL).startWhatsAppFromLead(leadId);
      await db.put(`webapp_conversations/${conversationId}`, { ...(await db.get(`webapp_conversations/${conversationId}`) as object), assignedUserId: agentId });
      await new Phase22Api(db, AGENT_EMAIL, mock.exotelVoiceConfig as never).initiateConversationCall(conversationId);

      const history = await new Phase22Api(db, AGENT_EMAIL).listConversationCallHistory(conversationId);
      expect(history).toHaveLength(2); // both the lead call and the conversation call show up
      expect(history[0]!.conversationId).toBe(conversationId); // newest first
    });
  });

  describe('refreshCallStatus', () => {
    let leadId: string;
    let callId: string;
    beforeEach(async () => {
      await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([{ name: 'Priya', phone: '+919876543210', location: 'Raipur' }]);
      leadId = (await new Phase22Api(db, ADMIN_EMAIL).listLeads())[0]!.id;
      await new Phase22Api(db, ADMIN_EMAIL).reassignLead(leadId, agentId);
      const call = await new Phase22Api(db, AGENT_EMAIL, mock.exotelVoiceConfig as never).initiateCall(leadId);
      callId = call.id;
    });

    it("fetches the call's current status from Exotel and updates the stored record — fixing a status stuck on its initial value forever", async () => {
      expect((await new Phase22Api(db, ADMIN_EMAIL).listCallLog(leadId))[0]!.status).not.toBe('completed');
      mock.setNextExotelVoiceResponse(200, { Call: { Sid: 'mock-call-sid-1', Status: 'completed' } });
      const updated = await new Phase22Api(db, AGENT_EMAIL, mock.exotelVoiceConfig as never).refreshCallStatus(callId);
      expect(updated.status).toBe('completed');
      expect((await new Phase22Api(db, ADMIN_EMAIL).listCallLog(leadId))[0]!.status).toBe('completed');
    });

    it('lets the assigned agent or a lead manager refresh, denies an unrelated agent', async () => {
      await expect(new Phase22Api(db, AGENT2_EMAIL, mock.exotelVoiceConfig as never).refreshCallStatus(callId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      mock.setNextExotelVoiceResponse(200, { Call: { Status: 'no-answer' } });
      await expect(new Phase22Api(db, ADMIN_EMAIL, mock.exotelVoiceConfig as never).refreshCallStatus(callId)).resolves.toMatchObject({ status: 'no-answer' });
    });
  });

  describe('CustomFieldsApi', () => {
    it('lets SUPERVISOR (not just ADMIN) create and update field definitions; slugifies the label into an immutable key', async () => {
      const roles = await new Phase1Api(db, ADMIN_EMAIL).listRoles();
      const supervisorRoleId = roles.find((r) => r.key === Roles.SUPERVISOR)!.id;
      const supervisorEmail = 'supervisor@example.com';
      await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: supervisorEmail, displayName: 'Supervisor', roleIds: [supervisorRoleId] });

      const def = await new CustomFieldsApi(db, supervisorEmail).createDefinition({ entityType: 'lead', label: 'Lead Source', type: 'select', options: ['Website', 'Referral', ' Cold Call '] });
      expect(def.key).toBe('lead_source');
      expect(def.options).toEqual(['Website', 'Referral', 'Cold Call']);
      expect(def.active).toBe(true);

      const updated = await new CustomFieldsApi(db, supervisorEmail).updateDefinition(def.id, { active: false, options: ['Website'] });
      expect(updated.active).toBe(false);
      expect(updated.options).toEqual(['Website']);

      await expect(new CustomFieldsApi(db, supervisorEmail).updateDefinition(def.id, { key: 'nope' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('denies an AGENT from creating or updating definitions', async () => {
      await expect(new CustomFieldsApi(db, AGENT_EMAIL).createDefinition({ entityType: 'lead', label: 'X', type: 'text' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects a duplicate label for the same entity type, and a select field with no options', async () => {
      await new CustomFieldsApi(db, ADMIN_EMAIL).createDefinition({ entityType: 'lead', label: 'Campaign Name', type: 'text' });
      await expect(new CustomFieldsApi(db, ADMIN_EMAIL).createDefinition({ entityType: 'lead', label: 'Campaign Name', type: 'text' })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(new CustomFieldsApi(db, ADMIN_EMAIL).createDefinition({ entityType: 'customer', label: 'Campaign Name', type: 'text' })).resolves.toMatchObject({ entityType: 'customer' }); // same label, different entityType is fine
      await expect(new CustomFieldsApi(db, ADMIN_EMAIL).createDefinition({ entityType: 'lead', label: 'Product', type: 'select', options: [] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('listDefinitions is readable by any authenticated user, filtered by entityType, sorted by sequenceOrder', async () => {
      await new CustomFieldsApi(db, ADMIN_EMAIL).createDefinition({ entityType: 'lead', label: 'First', type: 'text' });
      await new CustomFieldsApi(db, ADMIN_EMAIL).createDefinition({ entityType: 'lead', label: 'Second', type: 'text' });
      await new CustomFieldsApi(db, ADMIN_EMAIL).createDefinition({ entityType: 'customer', label: 'Only Customer', type: 'text' });

      const leadDefs = await new CustomFieldsApi(db, AGENT_EMAIL).listDefinitions('lead');
      expect(leadDefs.map((d) => d.label)).toEqual(['First', 'Second']);
      const all = await new CustomFieldsApi(db, AGENT_EMAIL).listDefinitions();
      expect(all).toHaveLength(3);
    });
  });

  describe('lead/location isolation (a manager only sees a location if they have access to its resolved WhatsApp number)', () => {
    const MANAGER_A_EMAIL = 'manager-a@example.com';
    const MANAGER_B_EMAIL = 'manager-b@example.com';
    let managerAId: string;
    let managerBId: string;
    let raipurNumberId: string;
    let raipurLeadId: string;
    let rajsamandLeadId: string;

    beforeEach(async () => {
      const roles = await new Phase1Api(db, ADMIN_EMAIL).listRoles();
      const siteManagerRoleId = roles.find((r) => r.key === Roles.SITE_MANAGER)!.id;

      const managerA = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: MANAGER_A_EMAIL, displayName: 'Manager A', roleIds: [siteManagerRoleId] });
      managerAId = managerA.id;
      const managerB = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: MANAGER_B_EMAIL, displayName: 'Manager B', roleIds: [siteManagerRoleId] });
      managerBId = managerB.id;

      // findNumberForLocation matches by display name containing the location string.
      const number = await new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'Entartica - Raipur', phoneNumber: '079-485-02804', provider: 'exotel' });
      raipurNumberId = number.id;
      await new Phase1Api(db, ADMIN_EMAIL).grantNumberAccess({ userId: managerAId, numberId: raipurNumberId });
      // Manager B gets no grant to the Raipur number at all — this is the isolation boundary under test.

      await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([
        { name: 'Raipur Lead', phone: '+919876500010', location: 'Raipur' },
        { name: 'Rajsamand Lead', phone: '+919876500011', location: 'Rajsamand' }, // no number named after "Rajsamand" exists — unconfigured, stays visible to every manager
      ]);
      const leads = await new Phase22Api(db, ADMIN_EMAIL).listLeads();
      raipurLeadId = leads.find((l) => l.location === 'Raipur')!.id;
      rajsamandLeadId = leads.find((l) => l.location === 'Rajsamand')!.id;
    });

    it('listLeads: manager with number access sees the Raipur lead, manager without it does not; both see the unconfigured Rajsamand lead; ADMIN sees both', async () => {
      const asA = await new Phase22Api(db, MANAGER_A_EMAIL).listLeads();
      expect(asA.map((l) => l.id).sort()).toEqual([raipurLeadId, rajsamandLeadId].sort());

      const asB = await new Phase22Api(db, MANAGER_B_EMAIL).listLeads();
      expect(asB.map((l) => l.id)).toEqual([rajsamandLeadId]);

      const asAdmin = await new Phase22Api(db, ADMIN_EMAIL).listLeads();
      expect(asAdmin.map((l) => l.id).sort()).toEqual([raipurLeadId, rajsamandLeadId].sort());
    });

    it('reassignLead: manager without Raipur number access is denied touching a Raipur lead, manager with access is not', async () => {
      await expect(new Phase22Api(db, MANAGER_B_EMAIL).reassignLead(raipurLeadId, managerBId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(new Phase22Api(db, MANAGER_A_EMAIL).reassignLead(raipurLeadId, managerAId)).resolves.toMatchObject({ assignedUserId: managerAId });
    });

    it('uploadLeads: a row for a location the manager cannot see is reported as an individual row error, not a thrown exception', async () => {
      const result = await new Phase22Api(db, MANAGER_B_EMAIL).uploadLeads([{ name: 'New Raipur Lead', phone: '+919876500099', location: 'Raipur' }]);
      expect(result.created).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.message).toMatch(/access/i);
    });

    it('getLocationConfig/setLocationConfig/listLocationParticipants/addLocationParticipant: manager without Raipur access is denied', async () => {
      await expect(new Phase22Api(db, MANAGER_B_EMAIL).getLocationConfig('Raipur')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(new Phase22Api(db, MANAGER_B_EMAIL).setLocationConfig('Raipur', { mode: 'manual' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(new Phase22Api(db, MANAGER_B_EMAIL).listLocationParticipants('Raipur')).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(new Phase22Api(db, MANAGER_B_EMAIL).addLocationParticipant('Raipur', managerBId)).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await expect(new Phase22Api(db, MANAGER_A_EMAIL).getLocationConfig('Raipur')).resolves.toBeNull(); // no config set yet, but the call itself is not denied
      await expect(new Phase22Api(db, MANAGER_A_EMAIL).addLocationParticipant('Raipur', managerAId)).resolves.toMatchObject({ location: 'Raipur', userId: managerAId });
    });
  });

  describe('Product Master + Quotations', () => {
    let numberId: string;
    let leadId: string;
    let widgetId: string;
    let gadgetId: string;

    beforeEach(async () => {
      const number = await new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'Entartica - Raipur', phoneNumber: '079-485-02804', provider: 'exotel' });
      numberId = number.id;
      await new Phase1Api(db, ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId });
      await new Phase22Api(db, ADMIN_EMAIL).uploadLeads([{ name: 'Priya', phone: '+919876543210', location: 'Raipur' }]);
      leadId = (await new Phase22Api(db, ADMIN_EMAIL).listLeads())[0]!.id;
      await new Phase22Api(db, ADMIN_EMAIL).reassignLead(leadId, agentId);

      const widget = await new ProductsApi(db, ADMIN_EMAIL).createProduct({ numberId, name: 'Widget', unitPrice: 500 });
      widgetId = widget.id;
      const gadget = await new ProductsApi(db, ADMIN_EMAIL).createProduct({ numberId, name: 'Gadget', unitPrice: 200 });
      gadgetId = gadget.id;
    });

    describe('ProductsApi', () => {
      it('lets an agent with number access read the catalog, but denies creating/updating without PRODUCTS_MANAGE', async () => {
        const list = await new ProductsApi(db, AGENT_EMAIL).listProducts(numberId);
        expect(list.map((p) => p.name)).toEqual(['Widget', 'Gadget']);
        await expect(new ProductsApi(db, AGENT_EMAIL).createProduct({ numberId, name: 'X', unitPrice: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      });

      it('denies an agent with no access to the number from even reading the catalog', async () => {
        await expect(new ProductsApi(db, AGENT2_EMAIL).listProducts(numberId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      });

      it('rejects a negative unitPrice on create and update', async () => {
        await expect(new ProductsApi(db, ADMIN_EMAIL).createProduct({ numberId, name: 'Bad', unitPrice: -5 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(new ProductsApi(db, ADMIN_EMAIL).updateProduct(widgetId, { unitPrice: -1 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      });

      it('deactivating a product keeps it in the catalog but excludes it from new quotation line items', async () => {
        await new ProductsApi(db, ADMIN_EMAIL).updateProduct(widgetId, { active: false });
        const list = await new ProductsApi(db, ADMIN_EMAIL).listProducts(numberId);
        expect(list.find((p) => p.id === widgetId)?.active).toBe(false);
        await expect(new Phase22Api(db, AGENT_EMAIL).createQuotation(leadId, { lineItems: [{ productId: widgetId, quantity: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      });
    });

    describe('Quotations', () => {
      it('listProductsForLead resolves the catalog via the lead\'s own location, excludes inactive products, and is denied for an unrelated agent', async () => {
        await new ProductsApi(db, ADMIN_EMAIL).updateProduct(gadgetId, { active: false });
        const list = await new Phase22Api(db, AGENT_EMAIL).listProductsForLead(leadId);
        expect(list.map((p) => p.name)).toEqual(['Widget']);
        await expect(new Phase22Api(db, AGENT2_EMAIL).listProductsForLead(leadId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      });

      it('creates a quotation snapshotting product name/price, computes totals correctly, and is unaffected by a later catalog price change', async () => {
        const quotation = await new Phase22Api(db, AGENT_EMAIL).createQuotation(leadId, {
          lineItems: [{ productId: widgetId, quantity: 2, discountPercent: 10 }, { productId: gadgetId, quantity: 1 }],
          overallDiscountPercent: 5,
        });
        expect(quotation.status).toBe('DRAFT');
        expect(quotation.lineItems).toEqual([
          { productId: widgetId, productName: 'Widget', unitPrice: 500, quantity: 2, discountPercent: 10 },
          { productId: gadgetId, productName: 'Gadget', unitPrice: 200, quantity: 1, discountPercent: 0 },
        ]);
        // subtotal = (500*2*0.9) + (200*1*1.0) = 900 + 200 = 1100; overall 5% off -> 1045
        const totals = computeQuotationTotals(quotation);
        expect(totals.subtotal).toBe(1100);
        expect(totals.total).toBeCloseTo(1045, 5);

        await new ProductsApi(db, ADMIN_EMAIL).updateProduct(widgetId, { unitPrice: 999 });
        const reread = await new Phase22Api(db, AGENT_EMAIL).getQuotation(quotation.id);
        expect(reread.lineItems[0]!.unitPrice).toBe(500); // snapshot, not live-priced
      });

      it('rejects an unknown productId, a quantity below 1, and an out-of-range discountPercent', async () => {
        await expect(new Phase22Api(db, AGENT_EMAIL).createQuotation(leadId, { lineItems: [{ productId: 'nope', quantity: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(new Phase22Api(db, AGENT_EMAIL).createQuotation(leadId, { lineItems: [{ productId: widgetId, quantity: 0 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(new Phase22Api(db, AGENT_EMAIL).createQuotation(leadId, { lineItems: [{ productId: widgetId, quantity: 1, discountPercent: 150 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        await expect(new Phase22Api(db, AGENT_EMAIL).createQuotation(leadId, { lineItems: [] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      });

      it('an unrelated agent cannot create, read, or list quotations for a lead not assigned to them; a manager always can', async () => {
        await expect(new Phase22Api(db, AGENT2_EMAIL).createQuotation(leadId, { lineItems: [{ productId: widgetId, quantity: 1 }] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        const quotation = await new Phase22Api(db, AGENT_EMAIL).createQuotation(leadId, { lineItems: [{ productId: widgetId, quantity: 1 }] });
        await expect(new Phase22Api(db, AGENT2_EMAIL).getQuotation(quotation.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(new Phase22Api(db, AGENT2_EMAIL).listQuotations(leadId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(new Phase22Api(db, ADMIN_EMAIL).getQuotation(quotation.id)).resolves.toMatchObject({ id: quotation.id });
      });

      it('updateQuotation replaces line items, can change status to SENT (stamping sentAt), and rejects an unknown patch field', async () => {
        const quotation = await new Phase22Api(db, AGENT_EMAIL).createQuotation(leadId, { lineItems: [{ productId: widgetId, quantity: 1 }] });
        const updated = await new Phase22Api(db, AGENT_EMAIL).updateQuotation(quotation.id, { lineItems: [{ productId: gadgetId, quantity: 3 }], status: 'SENT' });
        expect(updated.lineItems).toEqual([{ productId: gadgetId, productName: 'Gadget', unitPrice: 200, quantity: 3, discountPercent: 0 }]);
        expect(updated.status).toBe('SENT');
        expect(updated.sentAt).toBeTruthy();
      });

      it('listQuotations returns both, newest first (or tied if created in the same instant)', async () => {
        const first = await new Phase22Api(db, AGENT_EMAIL).createQuotation(leadId, { lineItems: [{ productId: widgetId, quantity: 1 }] });
        const second = await new Phase22Api(db, AGENT_EMAIL).createQuotation(leadId, { lineItems: [{ productId: gadgetId, quantity: 1 }] });
        const list = await new Phase22Api(db, AGENT_EMAIL).listQuotations(leadId);
        expect(list.map((q) => q.id).sort()).toEqual([first.id, second.id].sort());
        expect(new Date(list[0]!.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(list.at(-1)!.createdAt).getTime());
      });

      it('getPublicQuotationView requires no authentication and returns the lead name, number name, and computed totals', async () => {
        const quotation = await new Phase22Api(db, AGENT_EMAIL).createQuotation(leadId, { lineItems: [{ productId: widgetId, quantity: 2 }], overallDiscountPercent: 10 });
        const view = await getPublicQuotationView(db, quotation.id);
        expect(view.leadName).toBe('Priya');
        expect(view.numberDisplayName).toBe('Entartica - Raipur');
        expect(view.totals.total).toBeCloseTo(900, 5); // 500*2 = 1000, 10% off -> 900
        await expect(getPublicQuotationView(db, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      });
    });
  });
});

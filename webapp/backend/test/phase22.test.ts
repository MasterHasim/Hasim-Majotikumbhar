import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { Phase3Api } from '../src/services/phase3Api';
import { Phase8Api } from '../src/services/phase8Api';
import { Phase22Api } from '../src/services/phase22Api';
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

    it('denies a call for a lead not assigned to the caller', async () => {
      await expect(new Phase22Api(db, AGENT2_EMAIL, mock.exotelVoiceConfig as never).initiateCall(leadId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
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
});

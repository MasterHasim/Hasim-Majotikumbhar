import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { Phase3Api } from '../src/services/phase3Api';
import { Phase4Api } from '../src/services/phase4Api';
import { Phase5Api } from '../src/services/phase5Api';
import { Phase7Api, NumberAssignmentConfigApi } from '../src/services/phase7Api';
import { Phase8Api } from '../src/services/phase8Api';
import { Phase9Api } from '../src/services/phase9Api';
import { CustomFieldsApi } from '../src/services/customFieldsApi';
import { Roles } from '../src/domain/phase1';

const ADMIN_EMAIL = 'admin@example.com';
const AGENT_EMAIL = 'agent@example.com';
const AGENT2_EMAIL = 'agent2@example.com';

describe('CRM core (ported from Phase7-9 Domain/Services.gs)', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;
  let agentId: string;
  let agent2Id: string;
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

    const agent2 = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: AGENT2_EMAIL, displayName: 'Agent Two', roleIds: [] });
    agent2Id = agent2.id;
    await new Phase1Api(db, ADMIN_EMAIL).updateUser(agent2Id, { roleIds: [agentRoleId] });

    const number = await new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'Test Number', phoneNumber: '079-485-02801', provider: 'exotel' });
    numberId = number.id;
    await new Phase1Api(db, ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId });
    await new Phase1Api(db, ADMIN_EMAIL).grantNumberAccess({ userId: agent2Id, numberId });
  });

  afterEach(() => mock.restore());

  async function ingest(providerMessageId: string, fromPhone: string) {
    return new Phase4Api(db).ingestInboundMessage({
      providerMessageId, fromPhone, providerNumberId: '+917948502801',
      direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null,
    });
  }

  async function makeAgentAssignable(userId: string, order: number) {
    await new NumberAssignmentConfigApi(db, ADMIN_EMAIL).addAssignmentParticipant(numberId, userId, order);
    await new Phase1Api(db, ADMIN_EMAIL).setAssignmentEligibility({ userId, numberId, teamId: 'no-team', eligible: true });
    const ownerEmail = userId === agentId ? AGENT_EMAIL : AGENT2_EMAIL;
    await new Phase1Api(db, ownerEmail).setAvailability('available');
  }

  describe('NumberAssignmentConfigApi', () => {
    it('denies a non-admin from reading or writing assignment config', async () => {
      await expect(new NumberAssignmentConfigApi(db, AGENT_EMAIL).getNumberAssignmentConfig(numberId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(new NumberAssignmentConfigApi(db, AGENT_EMAIL).setNumberAssignmentConfig(numberId, { roundRobinEnabled: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('creates config on first write, updates it on subsequent writes', async () => {
      const created = await new NumberAssignmentConfigApi(db, ADMIN_EMAIL).setNumberAssignmentConfig(numberId, { roundRobinEnabled: true });
      expect(created.roundRobinEnabled).toBe(true);
      const updated = await new NumberAssignmentConfigApi(db, ADMIN_EMAIL).setNumberAssignmentConfig(numberId, { fallbackUserId: agentId });
      expect(updated.id).toBe(created.id);
      expect(updated.fallbackUserId).toBe(agentId);
    });

    it('rejects an unknown field in the config patch', async () => {
      await expect(new NumberAssignmentConfigApi(db, ADMIN_EMAIL).setNumberAssignmentConfig(numberId, { notAField: 1 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects adding the same participant twice', async () => {
      await new NumberAssignmentConfigApi(db, ADMIN_EMAIL).addAssignmentParticipant(numberId, agentId, 1);
      await expect(new NumberAssignmentConfigApi(db, ADMIN_EMAIL).addAssignmentParticipant(numberId, agentId, 2)).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('Phase7Api — round-robin assignment', () => {
    it('leaves a new lead unassigned when round-robin is not enabled and there is no fallback', async () => {
      const result = await ingest('msg-1', '+919876543210');
      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(result.conversationId!);
      expect(detail.conversation.assignedUserId).toBeFalsy();
    });

    it('applies the fallback user when round-robin is disabled but a fallback is configured', async () => {
      await new NumberAssignmentConfigApi(db, ADMIN_EMAIL).setNumberAssignmentConfig(numberId, { fallbackUserId: agentId });
      const result = await ingest('msg-1', '+919876543210');
      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(result.conversationId!);
      expect(detail.conversation.assignedUserId).toBe(agentId);
    });

    it('round-robins a new lead across eligible, available participants in sequence order', async () => {
      await new NumberAssignmentConfigApi(db, ADMIN_EMAIL).setNumberAssignmentConfig(numberId, { roundRobinEnabled: true });
      await makeAgentAssignable(agentId, 1);
      await makeAgentAssignable(agent2Id, 2);

      const first = await ingest('msg-1', '+919876543210');
      const firstDetail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(first.conversationId!);
      expect(firstDetail.conversation.assignedUserId).toBe(agentId);

      const second = await ingest('msg-2', '+919999999999');
      const secondDetail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(second.conversationId!);
      expect(secondDetail.conversation.assignedUserId).toBe(agent2Id);
    });

    it('re-assigns a returning customer to their prior owner instead of round-robin, once their old conversation is closed', async () => {
      await new NumberAssignmentConfigApi(db, ADMIN_EMAIL).setNumberAssignmentConfig(numberId, { roundRobinEnabled: true });
      await makeAgentAssignable(agentId, 1);
      await makeAgentAssignable(agent2Id, 2);

      const first = await ingest('msg-1', '+919876543210');
      const firstDetail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(first.conversationId!);
      expect(firstDetail.conversation.assignedUserId).toBe(agentId); // first round-robin pick

      // close the customer's only conversation so the next inbound message opens a NEW one
      await db.put(`webapp_conversations/${first.conversationId}`, { ...(await db.get(`webapp_conversations/${first.conversationId}`) as object), status: 'CLOSED' });

      const second = await ingest('msg-2', '+919876543210');
      expect(second.conversationId).not.toBe(first.conversationId);
      const secondDetail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(second.conversationId!);
      expect(secondDetail.conversation.assignedUserId).toBe(agentId); // returning customer -> prior owner, not agent2 (next in rotation)
    });

    it('an eligible-but-unavailable agent is skipped', async () => {
      await new NumberAssignmentConfigApi(db, ADMIN_EMAIL).setNumberAssignmentConfig(numberId, { roundRobinEnabled: true });
      await new NumberAssignmentConfigApi(db, ADMIN_EMAIL).addAssignmentParticipant(numberId, agentId, 1);
      await new Phase1Api(db, ADMIN_EMAIL).setAssignmentEligibility({ userId: agentId, numberId, teamId: 'no-team', eligible: true });
      // never marked available
      await makeAgentAssignable(agent2Id, 2);

      const result = await ingest('msg-1', '+919876543210');
      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(result.conversationId!);
      expect(detail.conversation.assignedUserId).toBe(agent2Id);
    });

    describe('reassignConversation / listAssignableUsers / listAssignmentHistory', () => {
      let conversationId: string;
      beforeEach(async () => {
        const result = await ingest('msg-1', '+919876543210');
        conversationId = result.conversationId!;
      });

      it('ADMIN can reassign a conversation to any active user, and it is recorded in history', async () => {
        const updated = await new Phase7Api(db, ADMIN_EMAIL).reassignConversation(conversationId, agentId);
        expect(updated.assignedUserId).toBe(agentId);
        const history = await new Phase7Api(db, ADMIN_EMAIL).listAssignmentHistory(conversationId);
        expect(history).toHaveLength(1);
        expect(history[0]!.userId).toBe(agentId);
        expect(history[0]!.reason).toBe('manual');
      });

      it('rejects reassigning to a nonexistent user', async () => {
        await expect(new Phase7Api(db, ADMIN_EMAIL).reassignConversation(conversationId, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      });

      it('listAssignableUsers returns all active users for ADMIN', async () => {
        const users = await new Phase7Api(db, ADMIN_EMAIL).listAssignableUsers(numberId);
        expect(users.map((u) => u.id)).toEqual(expect.arrayContaining([agentId, agent2Id]));
      });

      it('a plain AGENT with no team cannot list assignable users', async () => {
        await expect(new Phase7Api(db, AGENT_EMAIL).listAssignableUsers(numberId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      });

      /**
       * Regression test for a real crash: addTeamMember always writes numberIds: [] for a
       * "blank = all numbers" member, but Firebase RTDB drops empty arrays/objects on write —
       * so a round-tripped record comes back with numberIds simply absent, not []. Every
       * `.numberIds.length`/`.includes()` call site used to assume the array always existed and
       * threw a TypeError the first time this ever happened in real data (discovered live while
       * setting up Assignment Eligibility for real pilot agents). Simulated here by writing the
       * record without the field, matching what RTDB actually round-trips.
       */
      it('treats a team member whose numberIds field is entirely absent (RTDB-dropped empty array) as "all numbers" for eligibility, not a crash', async () => {
        const siteManagerRoleId = (await new Phase1Api(db, ADMIN_EMAIL).listRoles()).find((r) => r.key === Roles.SITE_MANAGER)!.id;
        const manager = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: 'manager@example.com', displayName: 'Manager', roleIds: [siteManagerRoleId] });
        const team = await new Phase1Api(db, ADMIN_EMAIL).createTeam({ name: 'Team A', ownerUserId: manager.id });
        const member = await new Phase1Api(db, ADMIN_EMAIL).addTeamMember({ teamId: team.id, userId: agentId, numberIds: [] });
        const raw = (await db.get<Record<string, unknown>>(`teamMembers/${member.id}`))!;
        delete raw.numberIds;
        await db.put(`teamMembers/${member.id}`, raw);

        await new Phase1Api(db, ADMIN_EMAIL).setAssignmentEligibility({ userId: agentId, numberId, teamId: team.id, eligible: true });
        await new Phase1Api(db, AGENT_EMAIL).setAvailability('available');

        const status = await new Phase1Api(db, ADMIN_EMAIL).getAssignmentEligibility(agentId, numberId);
        expect(status).toMatchObject({ assignmentEligible: true, assignableNow: true, reasons: [] });
      });
    });
  });

  describe('Phase8Api — lead stages, customer stage, remarks, customers', () => {
    it('seeds default stages exactly once', async () => {
      const stages = await new Phase8Api(db, ADMIN_EMAIL).seedDefaultLeadStages();
      expect(stages).toHaveLength(6);
      await expect(new Phase8Api(db, ADMIN_EMAIL).seedDefaultLeadStages()).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('denies a non-admin from creating or updating a stage', async () => {
      await expect(new Phase8Api(db, AGENT_EMAIL).createStage({ key: 'x', name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('sets and reads a customer stage, gated by conversation visibility', async () => {
      const stages = await new Phase8Api(db, ADMIN_EMAIL).seedDefaultLeadStages();
      const result = await ingest('msg-1', '+919876543210');
      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(result.conversationId!);
      const customerId = detail.customer!.id;

      // agent has number access but the conversation isn't assigned to them yet -> denied
      await expect(new Phase8Api(db, AGENT_EMAIL).setCustomerStage(customerId, stages[0]!.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await new Phase7Api(db, ADMIN_EMAIL).reassignConversation(result.conversationId!, agentId);
      const record = await new Phase8Api(db, AGENT_EMAIL).setCustomerStage(customerId, stages[0]!.id);
      expect(record.stageId).toBe(stages[0]!.id);
      const fetched = await new Phase8Api(db, AGENT_EMAIL).getCustomerStage(customerId);
      expect(fetched?.stageId).toBe(stages[0]!.id);
    });

    it('adds and lists remarks on a conversation the caller can view', async () => {
      const result = await ingest('msg-1', '+919876543210');
      await new Phase7Api(db, ADMIN_EMAIL).reassignConversation(result.conversationId!, agentId);
      const remark = await new Phase8Api(db, AGENT_EMAIL).addRemark(result.conversationId!, 'Called, no answer.');
      expect(remark.authorUserId).toBe(agentId);
      const remarks = await new Phase8Api(db, AGENT_EMAIL).listRemarks(result.conversationId!);
      expect(remarks).toHaveLength(1);
      expect(remarks[0]!.text).toBe('Called, no answer.');
    });

    it('denies adding a remark to a conversation not assigned to the caller', async () => {
      const result = await ingest('msg-1', '+919876543210');
      await expect(new Phase8Api(db, AGENT_EMAIL).addRemark(result.conversationId!, 'Hi')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('listCustomers returns all for ADMIN, only visible ones for an agent', async () => {
      const result = await ingest('msg-1', '+919876543210');
      await new Phase7Api(db, ADMIN_EMAIL).reassignConversation(result.conversationId!, agentId);

      const adminList = await new Phase8Api(db, ADMIN_EMAIL).listCustomers();
      expect(adminList).toHaveLength(1);

      const agentList = await new Phase8Api(db, AGENT_EMAIL).listCustomers();
      expect(agentList).toHaveLength(1);

      const agent2List = await new Phase8Api(db, AGENT2_EMAIL).listCustomers();
      expect(agent2List).toHaveLength(0);
    });

    it('updateCustomer allows name/email/company but rejects other fields', async () => {
      const result = await ingest('msg-1', '+919876543210');
      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(result.conversationId!);
      const updated = await new Phase8Api(db, ADMIN_EMAIL).updateCustomer(detail.customer!.id, { name: 'Eva' });
      expect(updated.name).toBe('Eva');
      await expect(new Phase8Api(db, ADMIN_EMAIL).updateCustomer(detail.customer!.id, { phone: '+910000000000' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('updateCustomer accepts and normalizes tags the same way as Lead tags', async () => {
      const result = await ingest('msg-2', '+919876543211');
      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(result.conversationId!);
      const updated = await new Phase8Api(db, ADMIN_EMAIL).updateCustomer(detail.customer!.id, { tags: [' Hot ', 'hot', ''] });
      expect(updated.tags).toEqual(['Hot']);
    });

    it('updateCustomer validates customFields against live definitions, merges rather than replaces, and clears blanked keys', async () => {
      await new CustomFieldsApi(db, ADMIN_EMAIL).createDefinition({ entityType: 'customer', label: 'Product Interest', type: 'text' });
      await new CustomFieldsApi(db, ADMIN_EMAIL).createDefinition({ entityType: 'customer', label: 'Expected Revenue', type: 'number' });
      const result = await ingest('msg-4', '+919876543213');
      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(result.conversationId!);
      const customerId = detail.customer!.id;

      const first = await new Phase8Api(db, ADMIN_EMAIL).updateCustomer(customerId, { customFields: { product_interest: 'CRM' } });
      expect(first.customFields).toEqual({ product_interest: 'CRM' });

      const second = await new Phase8Api(db, ADMIN_EMAIL).updateCustomer(customerId, { customFields: { expected_revenue: '75000' } });
      expect(second.customFields).toEqual({ product_interest: 'CRM', expected_revenue: 75000 });

      const third = await new Phase8Api(db, ADMIN_EMAIL).updateCustomer(customerId, { customFields: { product_interest: '' } });
      expect(third.customFields).toEqual({ expected_revenue: 75000 });

      await expect(new Phase8Api(db, ADMIN_EMAIL).updateCustomer(customerId, { customFields: { unknown_key: 'x' } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('listConversationActivity shows remarks, reassignment, and customer edits with resolved actor names, excluding denials', async () => {
      const result = await ingest('msg-3', '+919876543212');
      const conversationId = result.conversationId!;
      await new Phase7Api(db, ADMIN_EMAIL).reassignConversation(conversationId, agentId);
      await new Phase8Api(db, AGENT_EMAIL).addRemark(conversationId, 'Called, no answer.');
      const detail = await new Phase5Api(db, ADMIN_EMAIL).getConversationDetail(conversationId);
      await new Phase8Api(db, AGENT_EMAIL).updateCustomer(detail.customer!.id, { name: 'Eva' });
      await expect(new Phase8Api(db, AGENT2_EMAIL).addRemark(conversationId, 'Hi')).rejects.toMatchObject({ code: 'FORBIDDEN' }); // should not show up below

      const activity = await new Phase8Api(db, AGENT_EMAIL).listConversationActivity(conversationId);
      const actions = activity.map((e) => e.action);
      expect(actions).toContain('remark.added'); // matched via metadata.conversationId, not targetType
      expect(actions).toContain('customer.updated'); // matched via targetType 'customer' + the conversation's own customerId
      expect(actions).not.toContain('authorization.denied');
      const customerEdit = activity.find((e) => e.action === 'customer.updated')!;
      expect(customerEdit.actorName).toBe('Agent');
      expect(customerEdit.metadata.patch).toEqual({ name: 'Eva' });
    });
  });

  describe('Phase9Api — reminders and snooze', () => {
    let conversationId: string;
    beforeEach(async () => {
      const result = await ingest('msg-1', '+919876543210');
      conversationId = result.conversationId!;
      await new Phase7Api(db, ADMIN_EMAIL).reassignConversation(conversationId, agentId);
    });

    it('creates a reminder, lists it on the conversation and in my-reminders, and updates its status', async () => {
      const dueAt = new Date(Date.now() + 60_000).toISOString();
      const reminder = await new Phase9Api(db, AGENT_EMAIL).createReminder(conversationId, 'Follow up tomorrow', dueAt);
      expect(reminder.ownerUserId).toBe(agentId);
      expect(reminder.status).toBe('PENDING');

      const onConversation = await new Phase9Api(db, AGENT_EMAIL).listReminders(conversationId);
      expect(onConversation).toHaveLength(1);

      const mine = await new Phase9Api(db, AGENT_EMAIL).listMyReminders(numberId);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ numberId, customerPhone: '+919876543210' });
      const mineOther = await new Phase9Api(db, AGENT2_EMAIL).listMyReminders();
      expect(mineOther).toHaveLength(0);

      const updated = await new Phase9Api(db, AGENT_EMAIL).updateReminderStatus(reminder.id, 'COMPLETED');
      expect(updated.status).toBe('COMPLETED');
      const mineAfter = await new Phase9Api(db, AGENT_EMAIL).listMyReminders();
      expect(mineAfter).toHaveLength(0); // only PENDING reminders count
    });

    it('rejects an invalid reminder status', async () => {
      const reminder = await new Phase9Api(db, AGENT_EMAIL).createReminder(conversationId, 'X', new Date().toISOString());
      await expect(new Phase9Api(db, AGENT_EMAIL).updateReminderStatus(reminder.id, 'BOGUS')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('snoozes a conversation, hides it from the active inbox, then unsnoozes it', async () => {
      const until = new Date(Date.now() + 3_600_000).toISOString();
      await new Phase9Api(db, AGENT_EMAIL).snoozeConversation(conversationId, until);

      const status = await new Phase9Api(db, AGENT_EMAIL).getSnoozeStatus(conversationId);
      expect(status.snoozed).toBe(true);
      expect(status.snoozedUntil).toBe(until);

      const active = await new Phase5Api(db, AGENT_EMAIL).listConversations(numberId);
      expect(active.find((c) => c.id === conversationId)).toBeUndefined();

      const all = await new Phase5Api(db, AGENT_EMAIL).listConversationsAllStatuses(numberId);
      expect(all.find((c) => c.id === conversationId)).toBeDefined();

      await new Phase9Api(db, AGENT_EMAIL).unsnoozeConversation(conversationId);
      const statusAfter = await new Phase9Api(db, AGENT_EMAIL).getSnoozeStatus(conversationId);
      expect(statusAfter.snoozed).toBe(false);

      const activeAfter = await new Phase5Api(db, AGENT_EMAIL).listConversations(numberId);
      expect(activeAfter.find((c) => c.id === conversationId)).toBeDefined();
    });

    it('denies reminder/snooze access to a conversation not assigned to the caller', async () => {
      await expect(new Phase9Api(db, AGENT2_EMAIL).createReminder(conversationId, 'X', new Date().toISOString())).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(new Phase9Api(db, AGENT2_EMAIL).snoozeConversation(conversationId, new Date().toISOString())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});

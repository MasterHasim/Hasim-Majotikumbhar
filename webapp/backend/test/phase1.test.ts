import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { Phase3Api } from '../src/services/phase3Api';
import { Phase10Api } from '../src/services/phase10Api';
import { ApiError } from '../src/types';
import { Roles } from '../src/domain/phase1';

const ADMIN_EMAIL = 'admin@example.com';
const AGENT_EMAIL = 'agent@example.com';

describe('Phase1Api (ported from apps-script/src/Phase1Services.gs)', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;
  let adminId: string;
  let agentId: string;
  let numberId: string;

  function apiAs(email: string) {
    return new Phase1Api(db, email);
  }

  beforeEach(async () => {
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);

    const admin = await apiAs(ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, ADMIN_EMAIL);
    adminId = admin.id;

    const agent = await apiAs(ADMIN_EMAIL).createUser({ email: AGENT_EMAIL, displayName: 'Agent', roleIds: [] });
    agentId = agent.id;
    const roles = await apiAs(ADMIN_EMAIL).listRoles();
    const agentRoleId = roles.find((r) => r.key === Roles.AGENT)!.id;
    await apiAs(ADMIN_EMAIL).updateUser(agentId, { roleIds: [agentRoleId] });

    numberId = 'number_test_1';
  });

  afterEach(() => mock.restore());

  describe('bootstrap', () => {
    it('rejects a second bootstrap once users exist', async () => {
      await expect(apiAs(ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Again' }, ADMIN_EMAIL, ADMIN_EMAIL)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('rejects an identity that does not match the profile email', async () => {
      mock = await setupMockFirebase(); // fresh, un-bootstrapped store
      const freshDb = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);
      await expect(new Phase1Api(freshDb, 'someone-else@example.com').bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, 'someone-else@example.com')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects an identity not configured as the bootstrap admin', async () => {
      mock = await setupMockFirebase();
      const freshDb = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);
      await expect(new Phase1Api(freshDb, 'nobody@example.com').bootstrap({ email: 'nobody@example.com', displayName: 'X' }, ADMIN_EMAIL, 'nobody@example.com')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('creates all five roles and the first user as ADMIN', async () => {
      const roles = await apiAs(ADMIN_EMAIL).listRoles();
      expect(roles.map((r) => r.key).sort()).toEqual(['ADMIN', 'AGENT', 'SITE_MANAGER', 'SUPERVISOR', 'VIEWER'].sort());
      const whoAmI = await apiAs(ADMIN_EMAIL).whoAmI();
      expect(whoAmI.roleKeys).toEqual(['ADMIN']);
    });
  });

  describe('permission enforcement', () => {
    it('denies a non-admin creating a user', async () => {
      await expect(apiAs(AGENT_EMAIL).createUser({ email: 'x@example.com', displayName: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('denies a non-admin listing users', async () => {
      await expect(apiAs(AGENT_EMAIL).listUsers()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects a duplicate email on createUser', async () => {
      await expect(apiAs(ADMIN_EMAIL).createUser({ email: AGENT_EMAIL, displayName: 'Dup' })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('rejects an unknown identity entirely', async () => {
      await expect(apiAs('ghost@example.com').whoAmI()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('updateRole lets an admin grant a role a permission it did not already have, and validates against the real permission list', async () => {
      const roles = await apiAs(ADMIN_EMAIL).listRoles();
      const supervisorRole = roles.find((r) => r.key === Roles.SUPERVISOR)!;
      expect(supervisorRole.permissions).not.toContain('leads.manage');
      const updated = await apiAs(ADMIN_EMAIL).updateRole(supervisorRole.id, { permissions: [...supervisorRole.permissions, 'leads.manage'] });
      expect(updated.permissions).toContain('leads.manage');
      await expect(apiAs(ADMIN_EMAIL).updateRole(supervisorRole.id, { permissions: ['not.a.real.permission'] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(apiAs(AGENT_EMAIL).updateRole(supervisorRole.id, { permissions: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('welcome email', () => {
    function apiAsWithEmail(email: string) {
      return new Phase1Api(db, email, mock.emailEnv as never);
    }

    it('createUser sends a best-effort welcome email when Resend is configured, and is silent when it is not', async () => {
      await apiAsWithEmail(ADMIN_EMAIL).createUser({ email: 'new1@example.com', displayName: 'New One' });
      expect(mock.resendCalls).toHaveLength(1);
      expect(mock.resendCalls[0]!.to).toEqual(['new1@example.com']);
      expect(mock.resendCalls[0]!.subject).toContain('ECHT Connect');

      await apiAs(ADMIN_EMAIL).createUser({ email: 'new2@example.com', displayName: 'New Two' });
      expect(mock.resendCalls).toHaveLength(1); // unchanged — no env means no attempt, not an error
    });

    it('does not fail user creation when Resend rejects the send', async () => {
      mock.setNextResendResponse(500, { message: 'nope' });
      await expect(apiAsWithEmail(ADMIN_EMAIL).createUser({ email: 'new3@example.com', displayName: 'New Three' })).resolves.toMatchObject({ email: 'new3@example.com' });
    });

    it('sendWelcomeEmail throws CONFIGURATION_ERROR when Resend is not configured, and succeeds when it is', async () => {
      await expect(apiAs(ADMIN_EMAIL).sendWelcomeEmail(agentId)).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
      await expect(apiAsWithEmail(ADMIN_EMAIL).sendWelcomeEmail(agentId)).resolves.toMatchObject({ sent: true });
      expect(mock.resendCalls.some((c) => c.to.includes(AGENT_EMAIL))).toBe(true);
    });
  });

  describe('welcome WhatsApp', () => {
    const fullEnv = () => ({ ...mock.emailEnv, ...mock.exotelConfig } as never);

    async function seedApprovedWelcomeTemplate() {
      const number = await new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'Sending Number', phoneNumber: '079-485-02801', provider: 'exotel', wabaId: 'waba-welcome-1' });
      mock.setNextExotelResponse(200, { response: { whatsapp: { templates: [{ data: { id: 'ptpl-welcome', name: 'team_member_welcome', language: 'en', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{1}}, you are now a {{2}}. Sign in at {{3}}.' }] } }] } } });
      await new Phase10Api(db, ADMIN_EMAIL, mock.exotelConfig as never).syncTemplatesFromProvider('waba-welcome-1');
      return number;
    }

    it('createUser sends a best-effort WhatsApp welcome when Exotel + an APPROVED team_member_welcome template are configured, and is silent otherwise', async () => {
      await seedApprovedWelcomeTemplate();
      const sendsSoFar = () => mock.exotelCalls.filter((c) => c.path === 'messages').length;

      // No env at all — silent, no attempt.
      const noEnv = await apiAs(ADMIN_EMAIL).createUser({ email: 'wa1@example.com', displayName: 'Wa One', phone: '+919876500001' });
      expect(sendsSoFar()).toBe(0);
      expect(noEnv.phone).toBe('+919876500001');

      // Env configured but no phone on the new user — silent, no attempt.
      await new Phase1Api(db, ADMIN_EMAIL, fullEnv()).createUser({ email: 'wa2@example.com', displayName: 'Wa Two' });
      expect(sendsSoFar()).toBe(0);

      // Env configured and phone present — sends.
      await new Phase1Api(db, ADMIN_EMAIL, fullEnv()).createUser({ email: 'wa3@example.com', displayName: 'Wa Three', phone: '+919876500003' });
      const sendCall = mock.exotelCalls.find((c) => c.path === 'messages');
      expect(sendCall).toBeTruthy();
      const body = sendCall!.body as { whatsapp: { messages: { to: string; content: { type: string; template: { name: string } } } [] } };
      expect(body.whatsapp.messages[0]!.to).toContain('919876500003');
      expect(body.whatsapp.messages[0]!.content.type).toBe('template');
      expect(body.whatsapp.messages[0]!.content.template.name).toBe('team_member_welcome');
    });

    it('audits user.welcomeWhatsAppSent only on a successful send', async () => {
      await seedApprovedWelcomeTemplate();
      const user = await new Phase1Api(db, ADMIN_EMAIL, fullEnv()).createUser({ email: 'wa4@example.com', displayName: 'Wa Four', phone: '+919876500004' });
      const entries = await apiAs(ADMIN_EMAIL).listAuditLog();
      expect(entries.some((e) => e.action === 'user.welcomeWhatsAppSent' && e.targetId === user.id)).toBe(true);
    });

    it('does not fail user creation, and does not audit, when no APPROVED template exists yet', async () => {
      await expect(new Phase1Api(db, ADMIN_EMAIL, fullEnv()).createUser({ email: 'wa5@example.com', displayName: 'Wa Five', phone: '+919876500005' })).resolves.toMatchObject({ email: 'wa5@example.com' });
      expect(mock.exotelCalls).toHaveLength(0);
    });
  });

  describe('number access', () => {
    it('grant -> revoke -> reactivate round-trips correctly', async () => {
      const granted = await apiAs(ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId });
      expect(granted.granted).toBe(true);
      expect(granted.status).toBe('active');

      await expect(apiAs(ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId })).rejects.toMatchObject({ code: 'CONFLICT' });

      const revoked = await apiAs(ADMIN_EMAIL).revokeNumberAccess(granted.id);
      expect(revoked.granted).toBe(false);
      expect(revoked.status).toBe('inactive');

      const reactivated = await apiAs(ADMIN_EMAIL).reactivateNumberAccess(granted.id);
      expect(reactivated.granted).toBe(true);
      expect(reactivated.status).toBe('active');
    });
  });

  describe('validatePatch (field validation on update — matches Phase1Services.gs validatePatch_)', () => {
    it('updateUser rejects a roleIds patch that references a nonexistent role', async () => {
      await expect(apiAs(ADMIN_EMAIL).updateUser(agentId, { roleIds: ['role_does_not_exist'] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('updateUser rejects a roleIds patch that is not an array of strings', async () => {
      await expect(apiAs(ADMIN_EMAIL).updateUser(agentId, { roleIds: 'not-an-array' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    async function createSiteManagerOwnedTeam(name: string) {
      const roles = await apiAs(ADMIN_EMAIL).listRoles();
      const siteManagerRoleId = roles.find((r) => r.key === Roles.SITE_MANAGER)!.id;
      const slug = name.toLowerCase().replace(/\s+/g, '-');
      const owner = await apiAs(ADMIN_EMAIL).createUser({ email: `${slug}-owner@example.com`, displayName: 'Owner', roleIds: [siteManagerRoleId] });
      return apiAs(ADMIN_EMAIL).createTeam({ name, ownerUserId: owner.id });
    }

    it('updateTeamMember rejects a numberIds patch that is not an array of strings', async () => {
      const team = await createSiteManagerOwnedTeam('Team A');
      const member = await apiAs(ADMIN_EMAIL).addTeamMember({ teamId: team.id, userId: agentId });
      await expect(apiAs(ADMIN_EMAIL).updateTeamMember(member.id, { numberIds: 'not-an-array' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('updateTeamMember accepts a valid numberIds patch', async () => {
      const team = await createSiteManagerOwnedTeam('Team B');
      const member = await apiAs(ADMIN_EMAIL).addTeamMember({ teamId: team.id, userId: agentId });
      const updated = await apiAs(ADMIN_EMAIL).updateTeamMember(member.id, { numberIds: [numberId] });
      expect(updated.numberIds).toEqual([numberId]);
    });
  });

  describe('requireConversationOperation (the core authorization gate)', () => {
    it('ADMIN can view/reply/reassign on any number without an explicit grant', async () => {
      const access = apiAs(ADMIN_EMAIL).access;
      await expect(access.requireConversationOperation('view', { numberId })).resolves.toBeTruthy();
      await expect(access.requireConversationOperation('reply', { numberId })).resolves.toBeTruthy();
      await expect(access.requireConversationOperation('reassign', { numberId })).resolves.toBeTruthy();
    });

    it('AGENT is denied entirely without a granted number, even for their own assigned conversation', async () => {
      const access = apiAs(AGENT_EMAIL).access;
      await expect(access.requireConversationOperation('view', { numberId, assignedUserId: agentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('AGENT with a granted number can view/reply only their own assigned conversation, not someone else\'s', async () => {
      await apiAs(ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId });
      const access = apiAs(AGENT_EMAIL).access;

      await expect(access.requireConversationOperation('view', { numberId, assignedUserId: agentId })).resolves.toBeTruthy();
      await expect(access.requireConversationOperation('reply', { numberId, assignedUserId: agentId })).resolves.toBeTruthy();
      await expect(access.requireConversationOperation('view', { numberId, assignedUserId: 'someone-else' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(access.requireConversationOperation('reassign', { numberId, assignedUserId: agentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('revoking number access immediately removes view rights', async () => {
      const grant = await apiAs(ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId });
      await apiAs(ADMIN_EMAIL).revokeNumberAccess(grant.id);
      const access = apiAs(AGENT_EMAIL).access;
      await expect(access.requireConversationOperation('view', { numberId, assignedUserId: agentId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});

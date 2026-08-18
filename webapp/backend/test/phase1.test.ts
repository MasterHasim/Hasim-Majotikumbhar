import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
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

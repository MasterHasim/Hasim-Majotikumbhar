import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { setupMockD1 } from './helpers/mockD1';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { AppDb } from '../src/lib/appDb';
import { Phase1Api } from '../src/services/phase1Api';
import { D1MigrationApi } from '../src/services/d1MigrationApi';
import { d1Put } from '../src/lib/d1Store';
import { Roles } from '../src/domain/phase1';

const ADMIN_EMAIL = 'admin@example.com';
const AGENT_EMAIL = 'agent@example.com';

describe('D1MigrationApi (backfill / verifyParity — the D1 migration plan\'s Phase 4 tooling, 2026-08-31)', () => {
  let mock: MockFirebaseContext;
  let firebase: FirebaseDb;

  beforeEach(async () => {
    mock = await setupMockFirebase();
    firebase = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);
    await new Phase1Api(firebase, ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, ADMIN_EMAIL);
    const roles = await new Phase1Api(firebase, ADMIN_EMAIL).listRoles();
    const agentRoleId = roles.find((r) => r.key === Roles.AGENT)!.id;
    const agent = await new Phase1Api(firebase, ADMIN_EMAIL).createUser({ email: AGENT_EMAIL, displayName: 'Agent', roleIds: [] });
    await new Phase1Api(firebase, ADMIN_EMAIL).updateUser(agent.id, { roleIds: [agentRoleId] });
  });
  afterEach(() => mock.restore());

  describe('backfill', () => {
    it('denies a non-manager (no SETTINGS_MANAGE)', async () => {
      const { db: d1 } = setupMockD1();
      const app = new AppDb(firebase, d1, {});
      await expect(new D1MigrationApi(app, AGENT_EMAIL, d1).backfill(['adAccounts'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('copies every record of the named collection from Firebase into D1, idempotently', async () => {
      const { db: d1, tables } = setupMockD1();
      const app = new AppDb(firebase, d1, {});
      // Write directly to Firebase (this collection is still 'firebase'-mode, not yet cut over).
      await app.put('adAccounts/acct-1', { id: 'acct-1', platform: 'meta', name: 'Test Account', externalAccountId: '123', active: true, createdAt: '', updatedAt: '' });
      await app.put('adAccounts/acct-2', { id: 'acct-2', platform: 'meta', name: 'Second Account', externalAccountId: '456', active: false, createdAt: '', updatedAt: '' });

      const result = await new D1MigrationApi(app, ADMIN_EMAIL, d1).backfill(['adAccounts']);
      expect(result).toEqual([{ collection: 'adAccounts', recordCount: 2 }]);
      expect(tables.get('adAccounts')!.size).toBe(2);
      expect(JSON.parse(tables.get('adAccounts')!.get('acct-1')!.data as string)).toMatchObject({ name: 'Test Account' });

      // Re-running is safe — same two records, not duplicated or errored.
      const second = await new D1MigrationApi(app, ADMIN_EMAIL, d1).backfill(['adAccounts']);
      expect(second).toEqual([{ collection: 'adAccounts', recordCount: 2 }]);
      expect(tables.get('adAccounts')!.size).toBe(2);
    });

    it('rejects with a clear error when no D1 binding is configured, rather than crashing', async () => {
      const app = new AppDb(firebase, undefined, {});
      await expect(new D1MigrationApi(app, ADMIN_EMAIL, undefined).backfill(['adAccounts'])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('verifyParity', () => {
    it('reports clean parity (empty missing/extra/mismatched) right after a backfill', async () => {
      const { db: d1 } = setupMockD1();
      const app = new AppDb(firebase, d1, {});
      await app.put('quickReplies/qr-1', { id: 'qr-1', shortcut: '/hi', text: 'Hello!', active: true, createdAt: '', updatedAt: '' });
      await new D1MigrationApi(app, ADMIN_EMAIL, d1).backfill(['quickReplies']);

      const [report] = await new D1MigrationApi(app, ADMIN_EMAIL, d1).verifyParity(['quickReplies']);
      expect(report).toMatchObject({ collection: 'quickReplies', firebaseCount: 1, d1Count: 1, missingInD1: [], extraInD1: [], mismatched: [] });
    });

    it('flags a record that exists in Firebase but was never backfilled to D1', async () => {
      const { db: d1 } = setupMockD1();
      const app = new AppDb(firebase, d1, {});
      await app.put('quickReplies/qr-1', { id: 'qr-1', shortcut: '/hi', text: 'Hello!', active: true, createdAt: '', updatedAt: '' });
      // No backfill run.
      const [report] = await new D1MigrationApi(app, ADMIN_EMAIL, d1).verifyParity(['quickReplies']);
      expect(report.missingInD1).toEqual(['qr-1']);
      expect(report.firebaseCount).toBe(1);
      expect(report.d1Count).toBe(0);
    });

    it('flags a record whose D1 copy has drifted from the current Firebase content', async () => {
      const { db: d1 } = setupMockD1();
      const app = new AppDb(firebase, d1, {});
      await app.put('quickReplies/qr-1', { id: 'qr-1', shortcut: '/hi', text: 'Hello!', active: true, createdAt: '', updatedAt: '' });
      await new D1MigrationApi(app, ADMIN_EMAIL, d1).backfill(['quickReplies']);
      // Simulate real drift: Firebase updated after the backfill (e.g. dual-write hadn't started yet for this record).
      await app.put('quickReplies/qr-1', { id: 'qr-1', shortcut: '/hi', text: 'Hello, updated!', active: true, createdAt: '', updatedAt: '' });

      const [report] = await new D1MigrationApi(app, ADMIN_EMAIL, d1).verifyParity(['quickReplies']);
      expect(report.mismatched).toEqual(['qr-1']);
      expect(report.missingInD1).toEqual([]);
    });

    it('treats an absent field and an explicit empty array/object as equivalent, not a false-positive mismatch', async () => {
      const { db: d1, tables } = setupMockD1();
      const app = new AppDb(firebase, d1, {});
      // Firebase omits the field entirely (its real behavior for an empty array on write).
      await app.put('adAccounts/acct-1', { id: 'acct-1', platform: 'meta', name: 'Test', externalAccountId: '1', active: true, createdAt: '', updatedAt: '' });
      // D1's copy has the same record but with an explicit empty-array field D1 would faithfully keep.
      await d1Put(d1, 'adAccounts/acct-1', { id: 'acct-1', platform: 'meta', name: 'Test', externalAccountId: '1', active: true, createdAt: '', updatedAt: '', someArrayField: [] });
      expect(tables.get('adAccounts')!.size).toBe(1);

      const [report] = await new D1MigrationApi(app, ADMIN_EMAIL, d1).verifyParity(['adAccounts']);
      expect(report.mismatched).toEqual([]);
    });
  });
});

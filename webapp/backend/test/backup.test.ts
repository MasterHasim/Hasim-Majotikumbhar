import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { Phase3Api } from '../src/services/phase3Api';
import { Phase15Api } from '../src/services/phase15Api';

const ADMIN_EMAIL = 'admin@example.com';
const AGENT_EMAIL = 'agent@example.com';

describe('Phase15Api.backupNow (free-tier equivalent of Phase15Services.gs)', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;

  beforeEach(async () => {
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);
    await new Phase1Api(db, ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, ADMIN_EMAIL);
    const roles = await new Phase1Api(db, ADMIN_EMAIL).listRoles();
    const agentRoleId = roles.find((r) => r.key === 'AGENT')!.id;
    await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: AGENT_EMAIL, displayName: 'Agent', roleIds: [agentRoleId] });
    await new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'Test Number', phoneNumber: '079-485-02801', provider: 'exotel' });
  });

  afterEach(() => mock.restore());

  it('denies a non-manager (no SETTINGS_MANAGE)', async () => {
    await expect(new Phase15Api(db, AGENT_EMAIL).backupNow()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns a full snapshot of every collection actually written so far', async () => {
    const result = await new Phase15Api(db, ADMIN_EMAIL).backupNow();
    expect(result.name).toMatch(/^backup-/);
    expect(result.snapshot.users).toBeTruthy();
    expect(Object.keys(result.snapshot.users as object)).toHaveLength(2); // admin + agent
    expect(result.snapshot.numbers).toBeTruthy();
    expect(Object.keys(result.snapshot.numbers as object)).toHaveLength(1);
    expect(result.snapshot.roles).toBeTruthy();
  });

  it('writes an audit log entry for the backup', async () => {
    await new Phase15Api(db, ADMIN_EMAIL).backupNow();
    const auditLog = await new Phase1Api(db, ADMIN_EMAIL).listAuditLog();
    expect(auditLog.some((e) => e.action === 'backup.created')).toBe(true);
  });
});

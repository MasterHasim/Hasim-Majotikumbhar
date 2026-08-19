import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { Phase3Api } from '../src/services/phase3Api';
import { Phase4Api } from '../src/services/phase4Api';
import { Phase6Api } from '../src/services/phase6Api';
import { Roles } from '../src/domain/phase1';

const ADMIN_EMAIL = 'admin@example.com';
const AGENT_EMAIL = 'agent@example.com';

/** Minimal in-memory stand-in for the R2Bucket binding — just the two methods Phase6Api.uploadConversationMedia uses. Native R2 has no HTTP surface to intercept via mockFirebase's fetch mock, so this fakes the binding directly instead. */
function createFakeR2Bucket() {
  const store = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    store,
    async put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { bytes: value, contentType: options?.httpMetadata?.contentType ?? 'application/octet-stream' });
    },
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      return { body: entry.bytes, writeHttpMetadata: (headers: Headers) => headers.set('Content-Type', entry.contentType) };
    },
  } as never;
}

describe('Phase6Api.uploadConversationMedia (R2-backed, free-tier equivalent of Drive upload)', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;
  let agentId: string;
  let conversationId: string;
  let bucket: ReturnType<typeof createFakeR2Bucket>;

  beforeEach(async () => {
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);
    bucket = createFakeR2Bucket();

    await new Phase1Api(db, ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, ADMIN_EMAIL);
    const roles = await new Phase1Api(db, ADMIN_EMAIL).listRoles();
    const agentRoleId = roles.find((r) => r.key === Roles.AGENT)!.id;
    const agent = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: AGENT_EMAIL, displayName: 'Agent', roleIds: [] });
    agentId = agent.id;
    await new Phase1Api(db, ADMIN_EMAIL).updateUser(agentId, { roleIds: [agentRoleId] });

    const number = await new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'Test Number', phoneNumber: '079-485-02801', provider: 'exotel' });
    await new Phase1Api(db, ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId: number.id });

    const result = await new Phase4Api(db).ingestInboundMessage({
      providerMessageId: 'msg-1', fromPhone: '+919876543210', providerNumberId: '+917948502801',
      direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null,
    });
    conversationId = result.conversationId!;
    await db.put(`conversations/${conversationId}`, { ...(await db.get(`conversations/${conversationId}`) as object), assignedUserId: agentId });
  });

  afterEach(() => mock.restore());

  it('stores the decoded file in R2 with the given content type, keyed uniquely', async () => {
    const base64 = btoa('hello world');
    const { key } = await new Phase6Api(db, AGENT_EMAIL, { ...mock.exotelConfig, MEDIA_BUCKET: bucket } as never)
      .uploadConversationMedia(conversationId, base64, 'greeting.txt', 'text/plain');

    expect(bucket.store.has(key)).toBe(true);
    const stored = bucket.store.get(key)!;
    expect(new TextDecoder().decode(stored.bytes)).toBe('hello world');
    expect(stored.contentType).toBe('text/plain');
    expect(key).toContain('greeting.txt');
  });

  it('denies an agent uploading to a conversation not assigned to them', async () => {
    const other = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: 'other@example.com', displayName: 'Other', roleIds: [] });
    const roles = await new Phase1Api(db, ADMIN_EMAIL).listRoles();
    await new Phase1Api(db, ADMIN_EMAIL).updateUser(other.id, { roleIds: [roles.find((r) => r.key === Roles.AGENT)!.id] });
    await expect(
      new Phase6Api(db, 'other@example.com', { ...mock.exotelConfig, MEDIA_BUCKET: bucket } as never).uploadConversationMedia(conversationId, btoa('x'), 'x.txt', 'text/plain')
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('fails clearly when no media bucket is configured', async () => {
    await expect(
      new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).uploadConversationMedia(conversationId, btoa('x'), 'x.txt', 'text/plain')
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });
});

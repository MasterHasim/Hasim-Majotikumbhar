import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { setupMockKv, type MockKvContext } from './helpers/mockKv';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { Phase8Api } from '../src/services/phase8Api';
import { Phase11Api } from '../src/services/phase11Api';
import { CustomFieldsApi } from '../src/services/customFieldsApi';
import { cachedList, invalidateCache } from '../src/lib/kvCache';

const ADMIN_EMAIL = 'admin@example.com';

describe('kvCache (free-tier edge cache for stages/quick-replies/custom fields, 2026-08-31)', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;
  let kvCtx: MockKvContext;

  beforeEach(async () => {
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);
    kvCtx = setupMockKv();
    await new Phase1Api(db, ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, ADMIN_EMAIL);
  });
  afterEach(() => mock.restore());

  describe('cachedList / invalidateCache (the generic helper)', () => {
    it('calls the fetcher and populates the cache on a miss; a hit skips the fetcher entirely', async () => {
      let fetchCount = 0;
      const fetcher = async () => { fetchCount++; return ['a', 'b']; };

      const first = await cachedList(kvCtx.kv, 'test:key', fetcher);
      expect(first).toEqual(['a', 'b']);
      expect(fetchCount).toBe(1);

      const second = await cachedList(kvCtx.kv, 'test:key', fetcher);
      expect(second).toEqual(['a', 'b']);
      expect(fetchCount).toBe(1); // served from cache, fetcher not called again
    });

    it('invalidateCache makes the next read call the fetcher again', async () => {
      let fetchCount = 0;
      const fetcher = async () => { fetchCount++; return [fetchCount]; };

      await cachedList(kvCtx.kv, 'test:key', fetcher);
      await invalidateCache(kvCtx.kv, 'test:key');
      const afterInvalidate = await cachedList(kvCtx.kv, 'test:key', fetcher);

      expect(fetchCount).toBe(2);
      expect(afterInvalidate).toEqual([2]);
    });

    it('degrades to "no caching" (always calls the fetcher) when kv is undefined, never throws', async () => {
      let fetchCount = 0;
      const fetcher = async () => { fetchCount++; return ['x']; };
      await cachedList(undefined, 'test:key', fetcher);
      await cachedList(undefined, 'test:key', fetcher);
      expect(fetchCount).toBe(2);
      await expect(invalidateCache(undefined, 'test:key')).resolves.toBeUndefined();
    });
  });

  describe('Phase8Api.listStages — real read-through + invalidation-on-write', () => {
    it('caches across calls, and a new stage invalidates it', async () => {
      const api = new Phase8Api(db, ADMIN_EMAIL, undefined, kvCtx.kv);
      const seeded = await api.seedDefaultLeadStages(); // this itself invalidates once
      const first = await api.listStages();
      expect(first.map((s) => s.key)).toEqual(seeded.map((s) => s.key));
      expect(kvCtx.store.has('stages:all')).toBe(true);

      await api.createStage({ key: 'custom_stage', name: 'Custom Stage' });
      // Real proof of invalidation: read straight from the KV store bypassing listStages() —
      // the key must be gone immediately after the write, not just eventually.
      expect(kvCtx.store.has('stages:all')).toBe(false);

      const afterCreate = await api.listStages();
      expect(afterCreate.map((s) => s.key)).toContain('custom_stage');
    });
  });

  describe('Phase11Api.listQuickReplies — real read-through + invalidation-on-write', () => {
    it('caches across calls, and a new quick reply invalidates it', async () => {
      const api = new Phase11Api(db, ADMIN_EMAIL, { CONFIG_CACHE: kvCtx.kv });
      await api.listQuickReplies();
      expect(kvCtx.store.has('quickReplies:active')).toBe(true);

      await api.createQuickReply({ shortcut: '/hi', text: 'Hello!' });
      expect(kvCtx.store.has('quickReplies:active')).toBe(false);

      const afterCreate = await api.listQuickReplies();
      expect(afterCreate.map((q) => q.shortcut)).toContain('/hi');
    });
  });

  describe('CustomFieldsApi.listDefinitions — real read-through + invalidation-on-write, shared cache across entity types', () => {
    it('caches the unfiltered list once, both entity-type filters read the same cache entry, and a write invalidates it', async () => {
      const api = new CustomFieldsApi(db, ADMIN_EMAIL, kvCtx.kv);
      await api.listDefinitions('lead');
      await api.listDefinitions('customer');
      // One shared cache entry, not one per entityType filter.
      expect([...kvCtx.store.keys()]).toEqual(['customFieldDefinitions:all']);

      await api.createDefinition({ entityType: 'lead', label: 'Budget', type: 'text' });
      expect(kvCtx.store.has('customFieldDefinitions:all')).toBe(false);

      const afterCreate = await api.listDefinitions('lead');
      expect(afterCreate.map((d) => d.label)).toContain('Budget');
    });
  });
});

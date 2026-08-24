/**
 * Route-level regression test for a real bug found live 2026-08-24: itty-router does not
 * URL-decode path segments, so a path parameter containing a space (e.g. the "ECHT Marine"
 * lead location — the first location name with a space in it, everything before it was a
 * single word) arrived at every service method still literally "%20", failing validation
 * against the real, decoded location list. Every other test in this suite calls service
 * classes (Phase22Api, etc.) directly, bypassing the routing layer entirely — which is
 * exactly why this bug was invisible to 246 passing tests. This test dispatches a real
 * Request through the real router, the one thing that actually exercises param() decoding.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Router } from 'itty-router';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { __resetKeyCacheForTests } from '../src/lib/auth';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { registerPhase22Routes } from '../src/routes/phase22';
import { Roles } from '../src/domain/phase1';
import type { Env } from '../src/types';

const ADMIN_EMAIL = 'admin@example.com';

describe('param() path-segment decoding (route level, not service level)', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;
  let env: Env;
  let router: ReturnType<typeof Router>;

  beforeEach(async () => {
    __resetKeyCacheForTests();
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);
    await new Phase1Api(db, ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, ADMIN_EMAIL);
    // ADMIN has LEADS_MANAGE by default (see Roles), no extra role setup needed.
    void Roles;

    env = {
      FIREBASE_DATABASE_URL: mock.databaseUrl,
      ENVIRONMENT: 'test',
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(mock.serviceAccount),
      FIREBASE_WEB_API_KEY: 'test-key',
      MEDIA_BUCKET: undefined as never,
    };
    router = Router();
    registerPhase22Routes(router);
  });

  afterEach(() => mock.restore());

  async function request(path: string, init?: RequestInit): Promise<Response> {
    const token = await mock.signIdToken({ sub: 'admin-uid', email: ADMIN_EMAIL });
    return router.fetch(new Request(`https://test.local${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers } }), env) as Promise<Response>;
  }

  it('GET /api/locations/:location/assignment-config resolves a location containing a space, URL-encoded in the path', async () => {
    const res = await request('/api/locations/ECHT%20Marine/assignment-config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    expect(body).toBeNull(); // no config yet — the real bug returned a 400 before ever reaching this point
  });

  it('POST /api/locations/:location/assignment-config sets the mode for a location containing a space', async () => {
    const res = await request('/api/locations/ECHT%20Marine/assignment-config', { method: 'POST', body: JSON.stringify({ mode: 'single' }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { location: string; mode: string };
    expect(body.location).toBe('ECHT Marine');
    expect(body.mode).toBe('single');
  });

  it('a location with no space still works (baseline, unaffected by the fix)', async () => {
    const res = await request('/api/locations/Raipur/assignment-config');
    expect(res.status).toBe(200);
  });
});

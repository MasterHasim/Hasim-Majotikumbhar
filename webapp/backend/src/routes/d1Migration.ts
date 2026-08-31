import type { IRequest, RouterType } from 'itty-router';
import type { Env } from '../types';
import { buildContext } from '../lib/requestContext';
import { D1MigrationApi } from '../services/d1MigrationApi';

/** Ops-only endpoints for the Firebase RTDB -> D1 migration's staged rollout (see the migration
 * plan / PROGRESS.md). Not exposed in the UI — triggered directly while a collection is being
 * staged for its own cutover. Defaults to the two collections currently in 'dual' mode
 * (DATA_BACKEND_MODES in wrangler.toml) if the caller doesn't specify which. */
export function registerD1MigrationRoutes(router: RouterType) {
  router.post('/api/d1-migration/backfill', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await request.json().catch(() => ({}))) as { collections?: string[] };
    const collections = Array.isArray(body.collections) && body.collections.length > 0 ? body.collections : ['adAccounts', 'quickReplies'];
    return Response.json(await new D1MigrationApi(ctx.db, ctx.identityEmail, env.DB).backfill(collections));
  });
  router.post('/api/d1-migration/verify-parity', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await request.json().catch(() => ({}))) as { collections?: string[] };
    const collections = Array.isArray(body.collections) && body.collections.length > 0 ? body.collections : ['adAccounts', 'quickReplies'];
    return Response.json(await new D1MigrationApi(ctx.db, ctx.identityEmail, env.DB).verifyParity(collections));
  });
}

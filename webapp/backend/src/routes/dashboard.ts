import type { IRequest, RouterType } from 'itty-router';
import type { Env } from '../types';
import { buildContext } from '../lib/requestContext';
import { Phase14Api } from '../services/phase14Api';

/** Registers the Phase 14 (dashboard/analytics) endpoint — one-to-one with apps-script/src/Phase14Endpoints.gs. */
export function registerDashboardRoutes(router: RouterType) {
  router.get('/api/dashboard', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const numberId = new URL(request.url).searchParams.get('numberId') ?? undefined;
    return Response.json(await new Phase14Api(ctx.db, ctx.identityEmail).getDashboardMetrics(numberId));
  });
}

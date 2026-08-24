import type { IRequest, RouterType } from 'itty-router';
import type { Env } from '../types';
import { ApiError } from '../types';
import { buildContext } from '../lib/requestContext';
import { AdsApi } from '../services/adsApi';

async function json(request: IRequest): Promise<Record<string, unknown>> {
  return (await request.json().catch(() => ({}))) as Record<string, unknown>;
}
function param(request: IRequest, name: string): string {
  const value = request.params[name];
  if (!value) throw new ApiError(400, 'VALIDATION_ERROR', `Missing path parameter: ${name}`);
  // itty-router does not URL-decode path segments — see routes/phase22.ts's param() for the
  // real bug this fixes (a location name containing a space arrived here still "%20").
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Ad Performance — registered ad accounts (Admin-managed) and their spend/reach/messages-initiated insights. */
export function registerAdsRoutes(router: RouterType) {
  router.get('/api/ad-accounts', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new AdsApi(ctx.db, ctx.identityEmail, env).listAdAccounts());
  });
  router.post('/api/ad-accounts', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new AdsApi(ctx.db, ctx.identityEmail, env).createAdAccount(await json(request) as never));
  });
  router.patch('/api/ad-accounts/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new AdsApi(ctx.db, ctx.identityEmail, env).updateAdAccount(param(request, 'id'), await json(request)));
  });
  router.get('/api/ad-accounts/:id/insights', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    return Response.json(await new AdsApi(ctx.db, ctx.identityEmail, env).getAdInsights(param(request, 'id'), from, to));
  });
  router.get('/api/ad-campaigns/active', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new AdsApi(ctx.db, ctx.identityEmail, env).listActiveCampaigns());
  });
}

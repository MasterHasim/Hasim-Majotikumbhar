import type { IRequest, RouterType } from 'itty-router';
import type { Env } from '../types';
import { buildContext } from '../lib/requestContext';
import { Phase13Api, type SearchFilters } from '../services/phase13Api';

/** Registers Phase 13 (search + needs-response badges) endpoints — one-to-one with apps-script/src/Phase13Endpoints.gs. */
export function registerSearchRoutes(router: RouterType) {
  router.get('/api/search-conversations', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const params = new URL(request.url).searchParams;
    const filters: SearchFilters = {
      numberId: params.get('numberId') ?? undefined,
      query: params.get('query') ?? undefined,
      assignedUserId: params.get('assignedUserId') ?? undefined,
      customerId: params.get('customerId') ?? undefined,
      stageId: params.get('stageId') ?? undefined,
      status: params.get('status') ?? undefined,
      needsResponse: params.get('needsResponse') === 'true',
      unassigned: params.get('unassigned') === 'true',
      dateFrom: params.get('dateFrom') ?? undefined,
      dateTo: params.get('dateTo') ?? undefined,
    };
    return Response.json(await new Phase13Api(ctx.db, ctx.identityEmail).searchConversations(filters));
  });

  router.get('/api/needs-response-counts', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase13Api(ctx.db, ctx.identityEmail).getNeedsResponseCounts());
  });
}

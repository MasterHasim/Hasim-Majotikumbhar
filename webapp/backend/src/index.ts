import { Router } from 'itty-router';
import type { Env } from './types';
import { ApiError } from './types';
import { withCors } from './lib/cors';
import { registerPhase1Routes } from './routes/phase1';
import { registerMessagingRoutes } from './routes/messaging';

const router = Router();

router.get('/health', () => Response.json({ status: 'ok', service: 'whatsapp-panel-backend' }));

registerPhase1Routes(router);
registerMessagingRoutes(router);

router.all('*', () => new Response('Not found', { status: 404 }));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request, env);
    try {
      const response = await router.fetch(request, env);
      return withCors(response as Response, request, env);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : new ApiError(500, 'INTERNAL_ERROR', err instanceof Error ? err.message : String(err));
      if (apiError.status >= 500) console.error(apiError);
      return withCors(Response.json({ code: apiError.code, message: apiError.message }, { status: apiError.status }), request, env);
    }
  },
};

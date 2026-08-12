import { Router } from 'itty-router';
import type { Env } from './types';
import { ApiError, parseServiceAccount } from './types';
import { verifyIdToken, bearerToken } from './lib/auth';
import { withCors } from './lib/cors';

const router = Router();

router.get('/health', () => Response.json({ status: 'ok', service: 'whatsapp-panel-backend' }));

/**
 * Proves the whole auth pipeline end to end: frontend signs in with Firebase
 * Auth, sends the ID token as a Bearer header, this verifies it against
 * Google's public keys (no Admin SDK) and echoes back who the backend thinks
 * is signed in. Everything else gets built behind this same verification.
 */
router.get('/api/whoami', async (request, env: Env) => {
  const token = bearerToken(request);
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Missing Authorization: Bearer <idToken> header.');
  const serviceAccount = parseServiceAccount(env);
  const decoded = await verifyIdToken(token, serviceAccount.project_id);
  return Response.json({ uid: decoded.uid, email: decoded.email, claims: decoded.claims });
});

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

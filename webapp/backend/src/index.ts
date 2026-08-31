import { Router } from 'itty-router';
import type { Env } from './types';
import { ApiError } from './types';
import { withCors } from './lib/cors';
import { registerPhase1Routes } from './routes/phase1';
import { registerMessagingRoutes } from './routes/messaging';
import { registerCrmRoutes } from './routes/crm';
import { registerPhase22Routes } from './routes/phase22';
import { registerTemplateRoutes } from './routes/templates';
import { registerSearchRoutes } from './routes/search';
import { registerDashboardRoutes } from './routes/dashboard';
import { registerBackupRoutes } from './routes/backup';
import { registerAdsRoutes } from './routes/ads';
import { registerZohoTestRoutes } from './routes/zohoTest';
import { registerD1MigrationRoutes } from './routes/d1Migration';
import { syncCustomerToZoho, type ZohoCustomerSyncJob } from './services/zohoCrm';
import { buildAppDb } from './lib/appDb';
import { parseServiceAccount } from './types';

const router = Router();

router.get('/health', () => Response.json({ status: 'ok', service: 'whatsapp-panel-backend' }));

registerPhase1Routes(router);
registerMessagingRoutes(router);
registerCrmRoutes(router);
registerPhase22Routes(router);
registerTemplateRoutes(router);
registerSearchRoutes(router);
registerDashboardRoutes(router);
registerBackupRoutes(router);
registerAdsRoutes(router);
registerZohoTestRoutes(router);
registerD1MigrationRoutes(router);

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
  /** Cloudflare Queue consumer: retries transient Zoho/Firebase failures without involving React or the request path. */
  async queue(batch: MessageBatch<ZohoCustomerSyncJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const serviceAccount = parseServiceAccount(env);
        const db = buildAppDb(serviceAccount, env.FIREBASE_DATABASE_URL, env);
        await syncCustomerToZoho(db, message.body.customerId, env);
        message.ack();
      } catch (err) {
        console.error('Zoho customer sync failed; queue message will retry.', err);
        message.retry();
      }
    }
  },
};

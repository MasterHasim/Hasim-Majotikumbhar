import type { IRequest, RouterType } from 'itty-router';
import type { Env } from '../types';
import { buildContext } from '../lib/requestContext';
import { Phase15Api } from '../services/phase15Api';

/** Registers the backup endpoint — the free-tier equivalent of apps-script/src/Phase15Services.gs's backupNow(). */
export function registerBackupRoutes(router: RouterType) {
  router.post('/api/backup', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const result = await new Phase15Api(ctx.db, ctx.identityEmail).backupNow();
    return new Response(JSON.stringify(result.snapshot, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${result.name}.json"`,
      },
    });
  });
}

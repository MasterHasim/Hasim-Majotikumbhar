import type { IRequest, RouterType } from 'itty-router';
import type { Env } from '../types';
import { ApiError } from '../types';
import { buildContext } from '../lib/requestContext';
import { Phase10Api } from '../services/phase10Api';
import { Phase11Api } from '../services/phase11Api';

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

/** Registers Phase 10 (templates) and Phase 11 (quick replies) endpoints — one-to-one with apps-script/src/Phase{10,11}Endpoints.gs. Media send/upload live in messaging.ts alongside sendReply, mirroring Phase6Services.gs's own placement. */
export function registerTemplateRoutes(router: RouterType) {
  router.post('/api/templates', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase10Api(ctx.db, ctx.identityEmail).createDraftTemplate(await json(request) as never));
  });
  router.patch('/api/templates/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase10Api(ctx.db, ctx.identityEmail).updateDraftTemplate(param(request, 'id'), await json(request)));
  });
  router.patch('/api/templates/:id/labels', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { variables: unknown };
    return Response.json(await new Phase10Api(ctx.db, ctx.identityEmail).updateTemplateVariableLabels(param(request, 'id'), body.variables));
  });
  router.get('/api/templates', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase10Api(ctx.db, ctx.identityEmail).listTemplates());
  });
  router.get('/api/templates/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase10Api(ctx.db, ctx.identityEmail).getTemplate(param(request, 'id')));
  });
  router.post('/api/templates/:id/submit', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase10Api(ctx.db, ctx.identityEmail, env).submitTemplateForReview(param(request, 'id')));
  });
  router.post('/api/templates/sync', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { wabaId: string };
    return Response.json(await new Phase10Api(ctx.db, ctx.identityEmail, env).syncTemplatesFromProvider(body.wabaId));
  });

  router.post('/api/quick-replies', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase11Api(ctx.db, ctx.identityEmail).createQuickReply(await json(request) as never));
  });
  router.patch('/api/quick-replies/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase11Api(ctx.db, ctx.identityEmail).updateQuickReply(param(request, 'id'), await json(request)));
  });
  router.get('/api/quick-replies', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase11Api(ctx.db, ctx.identityEmail).listQuickReplies());
  });
}

import type { IRequest, RouterType } from 'itty-router';
import type { Env } from '../types';
import { ApiError } from '../types';
import { buildContext } from '../lib/requestContext';
import { Phase22Api } from '../services/phase22Api';

async function json(request: IRequest): Promise<Record<string, unknown>> {
  return (await request.json().catch(() => ({}))) as Record<string, unknown>;
}
function param(request: IRequest, name: string): string {
  const value = request.params[name];
  if (!value) throw new ApiError(400, 'VALIDATION_ERROR', `Missing path parameter: ${name}`);
  return value;
}
function query(request: IRequest, name: string): string | undefined {
  return new URL(request.url).searchParams.get(name) ?? undefined;
}

export function registerPhase22Routes(router: RouterType) {
  router.get('/api/lead-locations', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).listLocations());
  });

  router.post('/api/leads/upload', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { rows?: unknown };
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).uploadLeads(body.rows));
  });

  router.get('/api/leads', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const filters = { location: query(request, 'location'), status: query(request, 'status'), assignedUserId: query(request, 'assignedUserId') };
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).listLeads(filters));
  });

  router.post('/api/leads/:id/reassign', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { userId: string };
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).reassignLead(param(request, 'id'), body.userId));
  });

  router.get('/api/locations/:location/assignment-config', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).getLocationConfig(param(request, 'location')));
  });
  router.post('/api/locations/:location/assignment-config', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).setLocationConfig(param(request, 'location'), await json(request)));
  });
  router.get('/api/locations/:location/assignment-participants', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).listLocationParticipants(param(request, 'location')));
  });
  router.post('/api/locations/:location/assignment-participants', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { userId: string; sequenceOrder?: number };
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).addLocationParticipant(param(request, 'location'), body.userId, body.sequenceOrder));
  });
  router.patch('/api/location-assignment-participants/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).updateLocationParticipant(param(request, 'id'), await json(request)));
  });

  router.post('/api/leads/:id/call', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail, env).initiateCall(param(request, 'id')));
  });
  router.get('/api/leads/:id/call-log', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).listCallLog(param(request, 'id')));
  });
  router.get('/api/call-history', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).listCallHistory());
  });

  router.post('/api/leads/:id/stage', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { stageId: string };
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).setLeadStage(param(request, 'id'), body.stageId));
  });
  router.get('/api/leads/:id/stage', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).getLeadStage(param(request, 'id')));
  });
  router.post('/api/leads/:id/tags', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { tags: unknown };
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).updateLeadTags(param(request, 'id'), body.tags));
  });
  router.post('/api/leads/:id/remarks', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { text: string };
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).addLeadRemark(param(request, 'id'), body.text));
  });
  router.get('/api/leads/:id/remarks', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).listLeadRemarks(param(request, 'id')));
  });

  router.post('/api/leads/:id/start-whatsapp', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).startWhatsAppFromLead(param(request, 'id')));
  });
  router.post('/api/conversations/:id/call', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail, env).initiateConversationCall(param(request, 'id')));
  });
}

import type { IRequest, RouterType } from 'itty-router';
import type { Env } from '../types';
import { ApiError, parseServiceAccount } from '../types';
import { buildContext } from '../lib/requestContext';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { Phase22Api, getPublicQuotationView } from '../services/phase22Api';
import { CustomFieldsApi } from '../services/customFieldsApi';
import { ProductsApi } from '../services/productsApi';

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
  router.get('/api/leads/funnel', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).getLeadFunnel(query(request, 'location')));
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
  router.post('/api/calls/:id/refresh-status', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail, env).refreshCallStatus(param(request, 'id')));
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
  router.patch('/api/leads/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { name?: unknown; phone?: unknown };
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).updateLeadDetails(param(request, 'id'), body));
  });
  router.post('/api/leads/:id/custom-fields', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as Record<string, unknown>;
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).updateLeadCustomFields(param(request, 'id'), body));
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
  router.get('/api/leads/:id/activity', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).listLeadActivity(param(request, 'id')));
  });

  router.post('/api/leads/:id/start-whatsapp', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).startWhatsAppFromLead(param(request, 'id')));
  });
  router.post('/api/conversations/:id/call', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail, env).initiateConversationCall(param(request, 'id')));
  });

  router.get('/api/custom-fields', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new CustomFieldsApi(ctx.db, ctx.identityEmail).listDefinitions(query(request, 'entityType')));
  });
  router.post('/api/custom-fields', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new CustomFieldsApi(ctx.db, ctx.identityEmail).createDefinition(await json(request) as never));
  });
  router.patch('/api/custom-fields/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new CustomFieldsApi(ctx.db, ctx.identityEmail).updateDefinition(param(request, 'id'), await json(request)));
  });

  // --- Product Master ---
  router.get('/api/products', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new ProductsApi(ctx.db, ctx.identityEmail).listProducts(query(request, 'numberId') ?? ''));
  });
  router.post('/api/products', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new ProductsApi(ctx.db, ctx.identityEmail).createProduct(await json(request) as never));
  });
  router.patch('/api/products/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new ProductsApi(ctx.db, ctx.identityEmail).updateProduct(param(request, 'id'), await json(request)));
  });

  // --- Quotations ---
  router.get('/api/leads/:id/products', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).listProductsForLead(param(request, 'id')));
  });
  router.get('/api/leads/:id/quotations', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).listQuotations(param(request, 'id')));
  });
  router.post('/api/leads/:id/quotations', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).createQuotation(param(request, 'id'), await json(request) as never));
  });
  router.get('/api/quotations/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).getQuotation(param(request, 'id')));
  });
  router.patch('/api/quotations/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).updateQuotation(param(request, 'id'), await json(request) as never));
  });

  // --- Public (no Firebase auth) — the customer-facing quotation link, same "unguessable ID"
  // model routes/messaging.ts's public media serving already uses. ---
  router.get('/api/public/quotations/:id', async (request: IRequest, env: Env) => {
    const serviceAccount = parseServiceAccount(env);
    const db = new FirebaseDb(serviceAccount, env.FIREBASE_DATABASE_URL);
    return Response.json(await getPublicQuotationView(db, param(request, 'id')));
  });
}

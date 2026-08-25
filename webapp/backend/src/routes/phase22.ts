import type { IRequest, RouterType } from 'itty-router';
import type { Env } from '../types';
import { ApiError, parseServiceAccount } from '../types';
import { buildContext } from '../lib/requestContext';
import { timingSafeEqual } from '../lib/auth';
import { buildAppDb } from '../lib/appDb';
import { Phase22Api, getPublicQuotationView } from '../services/phase22Api';
import { CustomFieldsApi } from '../services/customFieldsApi';
import { ProductsApi } from '../services/productsApi';
import { parseCallStatusCallback } from '../services/exotelVoiceProvider';

async function json(request: IRequest): Promise<Record<string, unknown>> {
  return (await request.json().catch(() => ({}))) as Record<string, unknown>;
}
function param(request: IRequest, name: string): string {
  const value = request.params[name];
  if (!value) throw new ApiError(400, 'VALIDATION_ERROR', `Missing path parameter: ${name}`);
  // itty-router does not URL-decode path segments — a value containing a space (e.g. the
  // "ECHT Marine" location, added 2026-08-24) arrives here still literally "%20", which then
  // fails validation against the real, decoded value everywhere else in the codebase. Falls
  // back to the raw value on a malformed escape sequence rather than 500ing on it.
  try { return decodeURIComponent(value); } catch { return value; }
}
function query(request: IRequest, name: string): string | undefined {
  return new URL(request.url).searchParams.get(name) ?? undefined;
}

/** Built per-call rather than configured once on Exotel's dashboard (unlike the WhatsApp
 * webhook) — Exotel's Connect API takes a StatusCallback URL directly in the request, so no
 * external Exotel-side setup is needed for this piece. Same shared-secret token as the
 * WhatsApp webhook (WEBHOOK_SECRET_TOKEN) rather than a second secret. Omitted (undefined)
 * when the token isn't configured, so a misconfigured environment fails obviously (no
 * StatusCallback param sent, not a webhook silently accepting unauthenticated calls). */
function voiceStatusCallbackUrl(request: IRequest, env: Env): string | undefined {
  if (!env.WEBHOOK_SECRET_TOKEN) return undefined;
  return `${new URL(request.url).origin}/webhook/exotel-voice?token=${encodeURIComponent(env.WEBHOOK_SECRET_TOKEN)}`;
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

  router.post('/api/leads', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { name?: unknown; phone?: unknown; location?: unknown };
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).createLead(body));
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
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail, env).initiateCall(param(request, 'id'), voiceStatusCallbackUrl(request, env)));
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

  router.post('/api/leads/:id/reminders', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { text: string; dueAt: string };
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).createLeadReminder(param(request, 'id'), body.text, body.dueAt));
  });
  router.get('/api/leads/:id/reminders', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).listLeadReminders(param(request, 'id')));
  });

  router.get('/api/home-metrics', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).getHomeMetrics());
  });

  router.get('/api/auto-dialer-settings', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).getAutoDialerSettings());
  });
  router.patch('/api/auto-dialer-settings', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail).updateAutoDialerSettings(await json(request)));
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
  router.delete('/api/leads/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    await new Phase22Api(ctx.db, ctx.identityEmail).deleteLead(param(request, 'id'));
    return Response.json({ status: 'ok' });
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
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail, env).startWhatsAppFromLead(param(request, 'id')));
  });
  router.post('/api/conversations/:id/call', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase22Api(ctx.db, ctx.identityEmail, env).initiateConversationCall(param(request, 'id'), voiceStatusCallbackUrl(request, env)));
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
    const db = buildAppDb(serviceAccount, env.FIREBASE_DATABASE_URL, env);
    return Response.json(await getPublicQuotationView(db, param(request, 'id')));
  });

  // --- Exotel Voice status callback (no Firebase auth — shared secret token, same pattern as
  // /webhook/exotel for WhatsApp). UNVERIFIED against real traffic — see exotelVoiceProvider.ts's
  // note. Registered per-call via the StatusCallback param (see voiceStatusCallbackUrl above),
  // not configured once on Exotel's dashboard the way the WhatsApp webhook is. ---
  router.post('/webhook/exotel-voice', async (request: IRequest, env: Env) => {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!env.WEBHOOK_SECRET_TOKEN || !token || !timingSafeEqual(token, env.WEBHOOK_SECRET_TOKEN)) {
      return Response.json({ status: 'error', message: 'unauthorized' });
    }
    let outcome: unknown;
    let payload: Record<string, unknown> = {};
    try {
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        payload = (await request.json()) as Record<string, unknown>;
      } else {
        const form = await request.formData();
        for (const [key, value] of form.entries()) payload[key] = String(value);
      }
      const serviceAccount = parseServiceAccount(env);
      const db = buildAppDb(serviceAccount, env.FIREBASE_DATABASE_URL, env);
      const event = parseCallStatusCallback(payload);
      const result = await new Phase22Api(db, 'system@internal').applyCallStatusEvent(event);
      outcome = { status: 'ok', result };
    } catch (err) {
      outcome = { status: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    // Always logged (not just on error), unlike the WhatsApp webhook — this shape is
    // UNVERIFIED against real traffic, so the first several real calls need full visibility
    // to confirm parseCallStatusCallback is actually reading the right field names.
    console.log('webhook/exotel-voice payload', JSON.stringify(payload));
    console.log('webhook/exotel-voice', JSON.stringify(outcome));
    return Response.json(outcome);
  });
}

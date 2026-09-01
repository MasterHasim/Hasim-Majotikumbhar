import type { IRequest, RouterType } from 'itty-router';
import type { Env } from '../types';
import { ApiError, parseServiceAccount } from '../types';
import { buildContext } from '../lib/requestContext';
import { timingSafeEqual } from '../lib/auth';
import { buildAppDb } from '../lib/appDb';
import { Phase3Api } from '../services/phase3Api';
import { Phase4Api } from '../services/phase4Api';
import { Phase5Api } from '../services/phase5Api';
import { Phase6Api } from '../services/phase6Api';
import { WorkspaceApi } from '../services/workspaceApi';
import { ExotelProvider, requireExotelConfig } from '../services/exotelProvider';
import { ChatbotIntegrationApi } from '../services/chatbotIntegrationApi';
import { ChatbotProfileApi } from '../services/chatbotProfileApi';
import { Permissions } from '../domain/phase1';

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

export function registerMessagingRoutes(router: RouterType) {
  // --- Numbers (Phase3Api) ---
  router.post('/api/numbers', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase3Api(ctx.db, ctx.identityEmail).createNumber(await json(request) as never));
  });
  router.patch('/api/numbers/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase3Api(ctx.db, ctx.identityEmail).updateNumber(param(request, 'id'), await json(request)));
  });
  router.get('/api/numbers', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase3Api(ctx.db, ctx.identityEmail).listNumbers());
  });
  router.get('/api/my-numbers', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase5Api(ctx.db, ctx.identityEmail).listMyNumbers());
  });
  // Admin-only configuration/status. The generated raw key is returned once from the rotate
  // endpoint and is never persisted or returned by the status endpoint.
  router.get('/api/numbers/:id/chatbot/connection', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    await ctx.phase1.access.require(Permissions.NUMBERS_ADMIN);
    return Response.json(await new ChatbotIntegrationApi(ctx.db, env).getConnectionStatus(param(request, 'id')));
  });
  router.post('/api/numbers/:id/chatbot/key', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    await ctx.phase1.access.require(Permissions.NUMBERS_ADMIN);
    return Response.json(await new ChatbotIntegrationApi(ctx.db, env).rotateNumberApiKey(param(request, 'id')));
  });

  // --- Chatbot profiles (multi-bot-per-number, Phase 1, added 2026-09-01) — same admin gate as
  // the single-bot routes above; entirely additive, see chatbotProfileApi.ts. ---
  router.get('/api/numbers/:numberId/chatbot-profiles', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    await ctx.phase1.access.require(Permissions.NUMBERS_ADMIN);
    return Response.json(await new ChatbotProfileApi(ctx.db, env).listProfilesForNumber(param(request, 'numberId')));
  });
  router.post('/api/numbers/:numberId/chatbot-profiles', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    await ctx.phase1.access.require(Permissions.NUMBERS_ADMIN);
    return Response.json(await new ChatbotProfileApi(ctx.db, env).createProfile(param(request, 'numberId'), await json(request) as never));
  });
  router.patch('/api/chatbot-profiles/:profileId', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    await ctx.phase1.access.require(Permissions.NUMBERS_ADMIN);
    return Response.json(await new ChatbotProfileApi(ctx.db, env).updateProfile(param(request, 'profileId'), await json(request) as never));
  });
  router.post('/api/numbers/:numberId/chatbot-profiles/reorder', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    await ctx.phase1.access.require(Permissions.NUMBERS_ADMIN);
    const body = (await json(request)) as { orderedProfileIds: string[] };
    return Response.json(await new ChatbotProfileApi(ctx.db, env).reorderProfiles(param(request, 'numberId'), body.orderedProfileIds ?? []));
  });
  router.post('/api/chatbot-profiles/:profileId/key', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    await ctx.phase1.access.require(Permissions.NUMBERS_ADMIN);
    return Response.json(await new ChatbotProfileApi(ctx.db, env).rotateProfileApiKey(param(request, 'profileId')));
  });
  router.get('/api/chatbot-profiles/:profileId/connection', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    await ctx.phase1.access.require(Permissions.NUMBERS_ADMIN);
    return Response.json(await new ChatbotProfileApi(ctx.db, env).getProfileConnectionStatus(param(request, 'profileId')));
  });

  // --- Conversations (Phase5Api) ---
  router.get('/api/conversations', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const numberId = new URL(request.url).searchParams.get('numberId') ?? '';
    const allStatuses = new URL(request.url).searchParams.get('allStatuses') === 'true';
    const phase5 = new Phase5Api(ctx.db, ctx.identityEmail);
    return Response.json(allStatuses ? await phase5.listConversationsAllStatuses(numberId) : await phase5.listConversations(numberId));
  });
  router.get('/api/conversations/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase5Api(ctx.db, ctx.identityEmail).getConversationDetail(param(request, 'id')));
  });

  // --- Workspace aggregator ---
  router.get('/api/workspace/:conversationId', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const includeRealtime = new URL(request.url).searchParams.get('includeRealtime') === 'true';
    return Response.json(await new WorkspaceApi(ctx.db, ctx.identityEmail, env).getConversationWorkspace(param(request, 'conversationId'), includeRealtime));
  });

  // --- Send / resolve (Phase6Api) ---
  router.post('/api/conversations/start', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { numberId: string; phone: string; name?: string };
    return Response.json(await new Phase6Api(ctx.db, ctx.identityEmail, env).startNewConversation(body.numberId, body.phone, body.name));
  });
  router.post('/api/conversations/:id/reply', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { text: string };
    return Response.json(await new Phase6Api(ctx.db, ctx.identityEmail, env).sendReply(param(request, 'id'), body.text));
  });
  router.post('/api/conversations/:id/chatbot/handoff', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase6Api(ctx.db, ctx.identityEmail, env).handoffChatbotToHuman(param(request, 'id')));
  });
  router.post('/api/conversations/:id/chatbot/resume', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase6Api(ctx.db, ctx.identityEmail, env).resumeChatbot(param(request, 'id')));
  });
  router.post('/api/conversations/:id/resolve', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase6Api(ctx.db, ctx.identityEmail, env).resolveConversation(param(request, 'id')));
  });
  router.patch('/api/conversations/:id/products', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { productIds: unknown };
    return Response.json(await new Phase6Api(ctx.db, ctx.identityEmail, env).updateConversationProducts(param(request, 'id'), body.productIds));
  });
  router.post('/api/conversations/:id/send-template', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { templateId: string; variables?: Record<string, unknown> };
    return Response.json(await new Phase6Api(ctx.db, ctx.identityEmail, env).sendTemplateReply(param(request, 'id'), body.templateId, body.variables ?? {}));
  });
  router.post('/api/conversations/:id/send-media', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { mediaType: string; mediaUrl: string; caption?: string };
    return Response.json(await new Phase6Api(ctx.db, ctx.identityEmail, env).sendMediaReply(param(request, 'id'), body.mediaType, body.mediaUrl, body.caption ?? ''));
  });
  router.post('/api/conversations/:id/upload-media', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { base64Data: string; filename: string; mimeType: string };
    const { key } = await new Phase6Api(ctx.db, ctx.identityEmail, env).uploadConversationMedia(param(request, 'id'), body.base64Data, body.filename, body.mimeType);
    const url = `${new URL(request.url).origin}/media/${encodeURIComponent(key)}`;
    return Response.json({ url, key });
  });
  router.post('/api/admin/backfill-customer-service-window', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase6Api(ctx.db, ctx.identityEmail, env).backfillCustomerServiceWindow());
  });

  // --- Public media serving (no Firebase auth — the uploaded file must be fetchable by
  // Exotel's servers, not a signed-in browser, same "Anyone with the link" model the
  // Apps Script build's Drive-based upload used). Content-Type is set from what the
  // uploader recorded, not sniffed, so WhatsApp can tell an image from a generic blob —
  // the same real bug Drive's export=download link had before switching to export=view. ---
  router.get('/media/:key', async (request: IRequest, env: Env) => {
    const key = param(request, 'key');
    const object = await env.MEDIA_BUCKET.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return new Response(object.body, { headers });
  });

  // --- Exotel webhook (no Firebase auth — shared secret token instead, same as apps-script/src/Phase4Webhook.gs) ---
  router.post('/webhook/exotel', async (request: IRequest, env: Env) => {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!env.WEBHOOK_SECRET_TOKEN || !token || !timingSafeEqual(token, env.WEBHOOK_SECRET_TOKEN)) {
      return Response.json({ status: 'error', message: 'unauthorized' });
    }
    let outcome: unknown;
    let payload: unknown;
    try {
      payload = await request.json();
      const serviceAccount = parseServiceAccount(env);
      const db = buildAppDb(serviceAccount, env.FIREBASE_DATABASE_URL, env);
      const normalized = new ExotelProvider(requireExotelConfig(env)).processWebhook(payload as never);
      const result = await new Phase4Api(db, env.ZOHO_CUSTOMER_SYNC_QUEUE).ingestInboundMessage(normalized);
      outcome = { status: 'ok', result };
    } catch (err) {
      outcome = { status: 'error', message: err instanceof Error ? err.message : String(err) };
      // Raw payload only logged on failure — diagnosing a shape we haven't seen before
      // (e.g. a status-callback shape distinct from the confirmed-live inbound-message shape)
      // needs the real body, and logging every successful webhook would be noisy at volume.
      console.log('webhook/exotel raw payload (on error)', JSON.stringify(payload));
    }
    console.log('webhook/exotel', JSON.stringify(outcome));
    return Response.json(outcome);
  });

  /**
   * Per-number callback for the chatbot team. This endpoint intentionally uses only the
   * dedicated per-number key, never a Firebase browser token or an ECHT Connect user account.
   */
  router.post('/api/integrations/chatbot/numbers/:id/reply', async (request: IRequest, env: Env) => {
    const authorization = request.headers.get('Authorization') ?? '';
    const apiKey = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
    const serviceAccount = parseServiceAccount(env);
    const db = buildAppDb(serviceAccount, env.FIREBASE_DATABASE_URL, env);
    return Response.json(await new ChatbotIntegrationApi(db, env).receiveReply(param(request, 'id'), apiKey, await json(request) as never));
  });

  /** Same shape as the per-number callback above, but keyed by profile — for the multi-bot
   * system (Phase 1, added 2026-09-01). Also uses only the dedicated per-profile key. */
  router.post('/api/integrations/chatbot/profiles/:profileId/reply', async (request: IRequest, env: Env) => {
    const authorization = request.headers.get('Authorization') ?? '';
    const apiKey = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
    const serviceAccount = parseServiceAccount(env);
    const db = buildAppDb(serviceAccount, env.FIREBASE_DATABASE_URL, env);
    return Response.json(await new ChatbotProfileApi(db, env).receiveReply(param(request, 'profileId'), apiKey, await json(request) as never));
  });
}

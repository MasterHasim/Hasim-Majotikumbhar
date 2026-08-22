import type { IRequest, RouterType } from 'itty-router';
import type { Env } from '../types';
import { ApiError } from '../types';
import { buildContext } from '../lib/requestContext';
import { Phase7Api, NumberAssignmentConfigApi } from '../services/phase7Api';
import { Phase8Api } from '../services/phase8Api';
import { Phase9Api } from '../services/phase9Api';

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

export function registerCrmRoutes(router: RouterType) {
  // --- Phase7Api: assignment ---
  router.post('/api/conversations/:id/reassign', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { newUserId: string };
    return Response.json(await new Phase7Api(ctx.db, ctx.identityEmail).reassignConversation(param(request, 'id'), body.newUserId));
  });
  router.get('/api/conversations/:id/assignment-history', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase7Api(ctx.db, ctx.identityEmail).listAssignmentHistory(param(request, 'id')));
  });
  router.get('/api/assignable-users', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase7Api(ctx.db, ctx.identityEmail).listAssignableUsers(query(request, 'numberId') ?? ''));
  });

  // --- Number assignment config (round-robin setup) ---
  router.get('/api/numbers/:numberId/assignment-config', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new NumberAssignmentConfigApi(ctx.db, ctx.identityEmail).getNumberAssignmentConfig(param(request, 'numberId')));
  });
  router.post('/api/numbers/:numberId/assignment-config', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new NumberAssignmentConfigApi(ctx.db, ctx.identityEmail).setNumberAssignmentConfig(param(request, 'numberId'), await json(request)));
  });
  router.get('/api/numbers/:numberId/assignment-participants', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new NumberAssignmentConfigApi(ctx.db, ctx.identityEmail).listAssignmentParticipants(param(request, 'numberId')));
  });
  router.post('/api/numbers/:numberId/assignment-participants', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { userId: string; sequenceOrder?: number };
    return Response.json(await new NumberAssignmentConfigApi(ctx.db, ctx.identityEmail).addAssignmentParticipant(param(request, 'numberId'), body.userId, body.sequenceOrder));
  });
  router.patch('/api/assignment-participants/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new NumberAssignmentConfigApi(ctx.db, ctx.identityEmail).updateAssignmentParticipant(param(request, 'id'), await json(request)));
  });

  // --- Phase8Api: lead stages, customer stage, remarks, customers ---
  router.post('/api/lead-stages/seed-defaults', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase8Api(ctx.db, ctx.identityEmail).seedDefaultLeadStages());
  });
  router.post('/api/lead-stages', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase8Api(ctx.db, ctx.identityEmail).createStage(await json(request) as never));
  });
  router.patch('/api/lead-stages/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase8Api(ctx.db, ctx.identityEmail).updateStage(param(request, 'id'), await json(request)));
  });
  router.get('/api/lead-stages', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase8Api(ctx.db, ctx.identityEmail).listStages());
  });
  router.post('/api/customers/:id/stage', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { stageId: string };
    return Response.json(await new Phase8Api(ctx.db, ctx.identityEmail).setCustomerStage(param(request, 'id'), body.stageId));
  });
  router.get('/api/customers/:id/stage', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase8Api(ctx.db, ctx.identityEmail).getCustomerStage(param(request, 'id')));
  });
  router.post('/api/conversations/:id/remarks', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { text: string };
    return Response.json(await new Phase8Api(ctx.db, ctx.identityEmail).addRemark(param(request, 'id'), body.text));
  });
  router.get('/api/conversations/:id/remarks', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase8Api(ctx.db, ctx.identityEmail).listRemarks(param(request, 'id')));
  });
  /** Deliberately not bundled into getConversationWorkspace — the workspace call was already
   * close to Cloudflare Workers' per-invocation subrequest limit, and this section is collapsed
   * by default in the UI anyway, so lazy-loading it on expand is strictly better than paying for
   * it on every conversation open. Learned this the hard way: bundling it in once actually
   * exceeded the limit and silently broke sibling fields (including realtime) in the same call. */
  router.get('/api/conversations/:id/activity', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase8Api(ctx.db, ctx.identityEmail).listConversationActivity(param(request, 'id')));
  });
  router.get('/api/customers', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase8Api(ctx.db, ctx.identityEmail).listCustomers(query(request, 'numberId')));
  });
  router.patch('/api/customers/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase8Api(ctx.db, ctx.identityEmail).updateCustomer(param(request, 'id'), await json(request)));
  });

  // --- Phase9Api: reminders, snooze ---
  router.post('/api/conversations/:id/reminders', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { text: string; dueAt: string };
    return Response.json(await new Phase9Api(ctx.db, ctx.identityEmail).createReminder(param(request, 'id'), body.text, body.dueAt));
  });
  router.patch('/api/reminders/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { status: string };
    return Response.json(await new Phase9Api(ctx.db, ctx.identityEmail).updateReminderStatus(param(request, 'id'), body.status));
  });
  router.get('/api/conversations/:id/reminders', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase9Api(ctx.db, ctx.identityEmail).listReminders(param(request, 'id')));
  });
  router.get('/api/my-reminders', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase9Api(ctx.db, ctx.identityEmail).listMyReminders(query(request, 'numberId')));
  });
  router.post('/api/conversations/:id/snooze', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { until: string };
    return Response.json(await new Phase9Api(ctx.db, ctx.identityEmail).snoozeConversation(param(request, 'id'), body.until));
  });
  router.post('/api/conversations/:id/unsnooze', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase9Api(ctx.db, ctx.identityEmail).unsnoozeConversation(param(request, 'id')));
  });
  router.get('/api/conversations/:id/snooze-status', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await new Phase9Api(ctx.db, ctx.identityEmail).getSnoozeStatus(param(request, 'id')));
  });
}

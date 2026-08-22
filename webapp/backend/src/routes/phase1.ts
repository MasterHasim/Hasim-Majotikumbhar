import type { IRequest, RouterType } from 'itty-router';
import type { Env } from '../types';
import { ApiError } from '../types';
import { buildContext } from '../lib/requestContext';

async function json(request: IRequest): Promise<Record<string, unknown>> {
  return (await request.json().catch(() => ({}))) as Record<string, unknown>;
}

/** itty-router types route params as possibly-undefined (it can't statically know the pattern matched) — this asserts what the route pattern already guarantees. */
function param(request: IRequest, name: string): string {
  const value = request.params[name];
  if (!value) throw new ApiError(400, 'VALIDATION_ERROR', `Missing path parameter: ${name}`);
  return value;
}

/** Registers every Phase 1 (auth/roles/teams/number-access) endpoint — one-to-one with apps-script/src/Phase1Endpoints.gs. */
export function registerPhase1Routes(router: RouterType) {
  router.get('/api/whoami', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.whoAmI());
  });

  router.post('/api/bootstrap', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const profile = await json(request);
    return Response.json(await ctx.phase1.bootstrap(profile as { email: string; displayName: string }, env.BOOTSTRAP_ADMIN_EMAIL, ctx.identityEmail));
  });

  router.post('/api/users', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.createUser(await json(request) as never));
  });
  router.patch('/api/users/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.updateUser(param(request, 'id'), await json(request)));
  });
  router.post('/api/users/:id/welcome-email', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.sendWelcomeEmail(param(request, 'id')));
  });
  router.get('/api/users', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.listUsers());
  });

  router.get('/api/roles', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.listRoles());
  });
  router.patch('/api/roles/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.updateRole(param(request, 'id'), await json(request)));
  });

  router.post('/api/teams', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.createTeam(await json(request) as never));
  });
  router.patch('/api/teams/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.updateTeam(param(request, 'id'), await json(request)));
  });
  router.get('/api/teams', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.listTeams());
  });
  router.get('/api/teams/:teamId/members', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.listTeamMembers(param(request, 'teamId')));
  });

  router.post('/api/team-members', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.addTeamMember(await json(request) as never));
  });
  router.patch('/api/team-members/:id', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.updateTeamMember(param(request, 'id'), await json(request)));
  });

  router.post('/api/number-access', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.grantNumberAccess(await json(request) as never));
  });
  router.post('/api/number-access/:id/revoke', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.revokeNumberAccess(param(request, 'id')));
  });
  router.post('/api/number-access/:id/reactivate', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.reactivateNumberAccess(param(request, 'id')));
  });
  router.get('/api/number-access', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.listNumberAccess());
  });

  router.post('/api/availability', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { status: string };
    return Response.json(await ctx.phase1.setAvailability(body.status));
  });
  router.post('/api/users/:userId/availability', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { status: string };
    return Response.json(await ctx.phase1.setUserAvailability(param(request, 'userId'), body.status));
  });
  router.get('/api/availability/:userId', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.getAvailability(param(request, 'userId')));
  });

  router.get('/api/assignment-eligibility', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId') ?? '';
    const numberId = url.searchParams.get('numberId') ?? '';
    return Response.json(await ctx.phase1.getAssignmentEligibility(userId, numberId));
  });
  router.post('/api/assignment-eligibility', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.setAssignmentEligibility(await json(request) as never));
  });

  router.post('/api/authorize-conversation-operation', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const body = (await json(request)) as { action: 'view' | 'reply' | 'reassign'; context: { numberId: string; teamId?: string | null; assignedUserId?: string | null } };
    return Response.json(await ctx.phase1.access.requireConversationOperation(body.action, body.context));
  });

  router.get('/api/audit-log', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    return Response.json(await ctx.phase1.listAuditLog());
  });
}

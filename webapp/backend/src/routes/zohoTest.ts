import type { IRequest, RouterType } from 'itty-router';
import type { Env } from '../types';
import { ApiError } from '../types';
import { Roles } from '../domain/phase1';
import { buildContext } from '../lib/requestContext';
import { syncCustomerToZohoTestFunction } from '../services/zohoTestFunction';

function param(request: IRequest, name: string): string {
  const value = request.params[name];
  if (!value) throw new ApiError(400, 'VALIDATION_ERROR', `Missing path parameter: ${name}`);
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Explicit ADMIN-only, development-only trigger. It returns only counts and status, never payload data or the Function URL. */
export function registerZohoTestRoutes(router: RouterType) {
  router.post('/api/admin/zoho-test/customers/:id/sync', async (request: IRequest, env: Env) => {
    const ctx = await buildContext(request, env);
    const actor = await ctx.phase1.access.currentUser();
    if (!(await ctx.phase1.access.hasRole(actor, Roles.ADMIN))) throw new ApiError(403, 'FORBIDDEN', 'Admin access is required.');
    return Response.json(await syncCustomerToZohoTestFunction(ctx.db, param(request, 'id'), env));
  });
}

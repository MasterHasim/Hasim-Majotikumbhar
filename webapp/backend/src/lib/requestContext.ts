import type { Env } from '../types';
import { ApiError, parseServiceAccount } from '../types';
import { bearerToken, verifyIdToken } from './auth';
import { AppDb, buildAppDb } from './appDb';
import { Phase1Api } from '../services/phase1Api';

export interface RequestContext {
  db: AppDb;
  identityEmail: string;
  phase1: Phase1Api;
  env: Env;
}

/** Verifies the caller's Firebase ID token and builds the per-request service graph — the equivalent of every Apps Script endpoint implicitly having Session.getActiveUser() available. */
export async function buildContext(request: Request, env: Env): Promise<RequestContext> {
  const token = bearerToken(request);
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Missing Authorization: Bearer <idToken> header.');
  const serviceAccount = parseServiceAccount(env);
  const decoded = await verifyIdToken(token, serviceAccount.project_id);
  if (!decoded.email) throw new ApiError(401, 'UNAUTHENTICATED', 'Signed-in identity has no email.');
  const db = buildAppDb(serviceAccount, env.FIREBASE_DATABASE_URL, env);
  return { db, identityEmail: decoded.email.toLowerCase(), phase1: new Phase1Api(db, decoded.email.toLowerCase(), env), env };
}

import type { FirebaseServiceAccount } from './lib/firebaseAdmin';

/** Wrangler bindings — vars come from wrangler.toml, secrets from `wrangler secret put`. See README.md for the one-time setup list. */
export interface Env {
  FIREBASE_DATABASE_URL: string;
  ENVIRONMENT: string;
  /** Full service account JSON, as a string (`wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON`). */
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
  FIREBASE_WEB_API_KEY: string;
  EXOTEL_API_KEY?: string;
  EXOTEL_API_TOKEN?: string;
  EXOTEL_ACCOUNT_SID?: string;
  EXOTEL_SUBDOMAIN?: string;
  WEBHOOK_SECRET_TOKEN?: string;
  /** Comma-separated list of allowed frontend origins for CORS (e.g. "http://localhost:5173,https://panel.pages.dev"). */
  ALLOWED_ORIGINS?: string;
}

export function parseServiceAccount(env: Env): FirebaseServiceAccount {
  const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as FirebaseServiceAccount;
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields (client_email/private_key/project_id)');
  }
  return parsed;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

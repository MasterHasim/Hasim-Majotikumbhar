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
  /** Exotel Voice (click-to-call, Phase 22) — a separate product/credential set from the EXOTEL_* WhatsApp ones above. */
  EXOTEL_VOICE_ACCOUNT_SID?: string;
  EXOTEL_VOICE_API_KEY?: string;
  EXOTEL_VOICE_API_TOKEN?: string;
  EXOTEL_VOICE_CALLER_ID?: string;
  WEBHOOK_SECRET_TOKEN?: string;
  /** Comma-separated list of allowed frontend origins for CORS (e.g. "http://localhost:5173,https://panel.pages.dev"). */
  ALLOWED_ORIGINS?: string;
  /** The one identity allowed to call POST /api/bootstrap and become the first ADMIN — same role Script Property `wap.phase1.bootstrapAdminEmail` played in the Apps Script build. */
  BOOTSTRAP_ADMIN_EMAIL?: string;
  /** Onboarding email (Resend API, `wrangler secret put RESEND_API_KEY`) — sent best-effort when a new user is created; absence just means no email goes out, never blocks user creation itself. */
  RESEND_API_KEY?: string;
  /** e.g. "ECHT Connect <notifications@echt.co.in>" — must be on a domain verified in the Resend dashboard. */
  RESEND_FROM_EMAIL?: string;
  /** The hosted frontend's own URL, linked from the onboarding email so a new user knows where to sign in. */
  FRONTEND_URL?: string;
  /** Free-tier host for agent-uploaded media (Phase 6/11's uploadConversationMedia) — the equivalent of the Apps Script build's Drive-backed upload, since Workers has no local/persistent disk of its own. */
  MEDIA_BUCKET: R2Bucket;
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

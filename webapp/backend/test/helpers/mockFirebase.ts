/**
 * Test harness mocking the two external services the backend talks to:
 * Google's OAuth2/JWK endpoints and the Firebase Realtime Database REST API —
 * the same "mock UrlFetchApp" pattern the Apps Script build's Node tests used
 * (see apps-script/tests/*.js), adapted to Workers' `fetch`. A real (but
 * freshly-generated, throwaway, never-committed-anywhere-else) RSA keypair is
 * used so the actual Web Crypto signing/verification code paths run for
 * real, not just a stubbed-out shortcut — the same "prove it, don't assume
 * it" discipline that caught real bugs in the Apps Script realtime work.
 */
import { webcrypto } from 'node:crypto';
import type { FirebaseServiceAccount } from '../../src/lib/firebaseAdmin';

const subtle = webcrypto.subtle;

export interface MockFirebaseContext {
  serviceAccount: FirebaseServiceAccount;
  databaseUrl: string;
  store: Record<string, Record<string, unknown>>;
  signIdToken(payload: { sub: string; email: string; extraClaims?: Record<string, unknown> }): Promise<string>;
  restore(): void;
  /** Mock Exotel account, matching the shape src/services/exotelProvider.ts's requireExotelConfig() expects. */
  exotelConfig: { EXOTEL_API_KEY: string; EXOTEL_API_TOKEN: string; EXOTEL_ACCOUNT_SID: string; EXOTEL_SUBDOMAIN: string };
  /** Every call made to the mock Exotel endpoint, for assertions. */
  exotelCalls: { method: string; path: string; body: unknown }[];
  /** Override the next Exotel response (status + body) — defaults to a 200 with a fake sid. */
  setNextExotelResponse(status: number, body: unknown): void;
  /** Mock Exotel Voice account, matching src/services/exotelVoiceProvider.ts's requireExotelVoiceConfig() expects. */
  exotelVoiceConfig: { EXOTEL_VOICE_ACCOUNT_SID: string; EXOTEL_VOICE_API_KEY: string; EXOTEL_VOICE_API_TOKEN: string; EXOTEL_VOICE_CALLER_ID: string };
  /** Every call made to the mock Exotel Voice endpoint, for assertions. */
  exotelVoiceCalls: { path: string; params: Record<string, string> }[];
  /** Override the next Exotel Voice response (status + body) — defaults to a 200 with a fake call sid. */
  setNextExotelVoiceResponse(status: number, body: unknown): void;
  /** Mock Resend/email env, matching src/lib/email.ts's getEmailConfig() expects. */
  emailEnv: { RESEND_API_KEY: string; RESEND_FROM_EMAIL: string; FRONTEND_URL: string };
  /** Every call made to the mock Resend endpoint, for assertions. */
  resendCalls: { to: string[]; subject: string; html: string }[];
  /** Override the next Resend response (status + body) — defaults to a 200. */
  setNextResendResponse(status: number, body: unknown): void;
  /** Mock Meta env, matching src/services/metaAdsProvider.ts's requireMetaAdsConfig() expects. */
  metaAdsEnv: { META_ACCESS_TOKEN: string };
  /** Every call made to the mock Meta Graph API endpoint, for assertions. */
  metaAdsCalls: { url: string }[];
  /** Override the next Meta Graph API response (status + body) — defaults to a 200 with no rows. */
  setNextMetaAdsResponse(status: number, body: unknown): void;
  /** Mock Zoho OAuth/CRM environment; its values are intentionally available only to backend tests. */
  zohoEnv: { ZOHO_CLIENT_ID: string; ZOHO_CLIENT_SECRET: string; ZOHO_REFRESH_TOKEN: string; ZOHO_ACCOUNTS_URL: string; ZOHO_CONTACT_EXTERNAL_ID_FIELD: string };
  /** Every Contact upsert made to the mock Zoho API. */
  zohoContactUpserts: { authorization: string | null; body: Record<string, unknown> }[];
}

function base64UrlFromBuffer(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlFromString(value: string): string {
  return base64UrlFromBuffer(new TextEncoder().encode(value).buffer as ArrayBuffer);
}

export async function setupMockFirebase(projectId = 'test-project'): Promise<MockFirebaseContext> {
  const keyPair = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const privateJwk = await subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = (await subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey & { kid?: string };
  const kid = 'test-key-1';
  publicJwk.kid = kid;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  // PKCS8 PEM, matching the shape a real Firebase service account JSON's private_key field has.
  const pkcs8 = await subtle.importKey('jwk', privateJwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['sign']);
  const pkcs8Bytes = await subtle.exportKey('pkcs8', pkcs8);
  const pkcs8Base64 = base64UrlFromBuffer(pkcs8Bytes).replace(/-/g, '+').replace(/_/g, '/');
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8Base64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;

  const serviceAccount: FirebaseServiceAccount = { client_email: 'test-sa@test-project.iam.gserviceaccount.com', private_key: pem, project_id: projectId };
  const databaseUrl = 'https://test-project-default-rtdb.firebaseio.com';
  const store: Record<string, Record<string, unknown>> = {};

  async function signIdToken(payload: { sub: string; email: string; extraClaims?: Record<string, unknown> }): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid };
    const claims = { iss: `https://securetoken.google.com/${projectId}`, aud: projectId, iat: now, exp: now + 3600, sub: payload.sub, email: payload.email, ...payload.extraClaims };
    const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;
    const signature = await subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(signingInput));
    return `${signingInput}.${base64UrlFromBuffer(signature)}`;
  }

  const exotelSubdomain = 'test-exotel.example.com';
  const exotelConfig = { EXOTEL_API_KEY: 'test-key', EXOTEL_API_TOKEN: 'test-token', EXOTEL_ACCOUNT_SID: 'test-sid', EXOTEL_SUBDOMAIN: exotelSubdomain };
  const exotelCalls: { method: string; path: string; body: unknown }[] = [];
  let nextExotelResponse: { status: number; body: unknown } | null = null;
  let exotelSidCounter = 0;

  const exotelVoiceConfig = { EXOTEL_VOICE_ACCOUNT_SID: 'test-voice-sid', EXOTEL_VOICE_API_KEY: 'test-voice-key', EXOTEL_VOICE_API_TOKEN: 'test-voice-token', EXOTEL_VOICE_CALLER_ID: '07900000000' };
  const exotelVoiceCalls: { path: string; params: Record<string, string> }[] = [];
  let nextExotelVoiceResponse: { status: number; body: unknown } | null = null;
  let exotelVoiceCallSidCounter = 0;

  const emailEnv = { RESEND_API_KEY: 'test-resend-key', RESEND_FROM_EMAIL: 'ECHT Connect <test@example.com>', FRONTEND_URL: 'https://example.test' };
  const resendCalls: { to: string[]; subject: string; html: string }[] = [];
  let nextResendResponse: { status: number; body: unknown } | null = null;

  const metaAdsEnv = { META_ACCESS_TOKEN: 'test-meta-token' };
  const metaAdsCalls: { url: string }[] = [];
  let nextMetaAdsResponse: { status: number; body: unknown } | null = null;

  const zohoEnv = { ZOHO_CLIENT_ID: 'test-zoho-client', ZOHO_CLIENT_SECRET: 'test-zoho-secret', ZOHO_REFRESH_TOKEN: 'test-zoho-refresh', ZOHO_ACCOUNTS_URL: 'https://accounts.zoho.test', ZOHO_CONTACT_EXTERNAL_ID_FIELD: 'Echt_Customer_ID' };
  const zohoContactUpserts: { authorization: string | null; body: Record<string, unknown> }[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith(`https://${exotelSubdomain}/v2/accounts/`)) {
      const path = url.split(`/v2/accounts/${exotelConfig.EXOTEL_ACCOUNT_SID}/`)[1] ?? '';
      const body = init?.body ? JSON.parse(init.body as string) : null;
      exotelCalls.push({ method: (init?.method ?? 'GET').toUpperCase(), path, body });
      if (nextExotelResponse) {
        const { status, body: respBody } = nextExotelResponse;
        nextExotelResponse = null;
        return new Response(JSON.stringify(respBody), { status });
      }
      exotelSidCounter += 1;
      // Matches the real confirmed-live send-response envelope (2026-08-23): everything wrapped
      // under "response.whatsapp", each message entry's id nested under "data.sid" — not the
      // flatter shape this mock used to return, which no real Exotel response actually has.
      return new Response(JSON.stringify({ request_id: 'mock-request', method: (init?.method ?? 'GET').toUpperCase(), http_code: 200, metadata: { failed: 0, total: 1, success: 1 }, response: { whatsapp: { messages: [{ code: 202, error_data: null, status: 'success', data: { sid: `mock-sid-${exotelSidCounter}` } }] } } }), { status: 200 });
    }

    if (url.startsWith(`https://api.exotel.com/v1/Accounts/${exotelVoiceConfig.EXOTEL_VOICE_ACCOUNT_SID}/`)) {
      const path = url.split(`/v1/Accounts/${exotelVoiceConfig.EXOTEL_VOICE_ACCOUNT_SID}/`)[1] ?? '';
      const params = Object.fromEntries(new URLSearchParams(init?.body as string));
      exotelVoiceCalls.push({ path, params });
      if (nextExotelVoiceResponse) {
        const { status, body: respBody } = nextExotelVoiceResponse;
        nextExotelVoiceResponse = null;
        return new Response(JSON.stringify(respBody), { status });
      }
      exotelVoiceCallSidCounter += 1;
      return new Response(JSON.stringify({ Call: { Sid: `mock-call-sid-${exotelVoiceCallSidCounter}`, Status: 'in-progress' } }), { status: 200 });
    }

    if (url === 'https://api.resend.com/emails') {
      const body = JSON.parse(init!.body as string) as { to: string[]; subject: string; html: string };
      resendCalls.push(body);
      if (nextResendResponse) {
        const { status, body: respBody } = nextResendResponse;
        nextResendResponse = null;
        return new Response(JSON.stringify(respBody), { status });
      }
      return new Response(JSON.stringify({ id: 'mock-email-id' }), { status: 200 });
    }

    if (url.startsWith('https://graph.facebook.com/')) {
      metaAdsCalls.push({ url });
      if (nextMetaAdsResponse) {
        const { status, body: respBody } = nextMetaAdsResponse;
        nextMetaAdsResponse = null;
        return new Response(JSON.stringify(respBody), { status });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }

    if (url === `${zohoEnv.ZOHO_ACCOUNTS_URL}/oauth/v2/token`) {
      return new Response(JSON.stringify({ access_token: 'mock-zoho-access-token', api_domain: 'https://zoho-api.test', expires_in: 3600 }), { status: 200 });
    }
    if (url === 'https://zoho-api.test/crm/v8/Contacts/upsert') {
      const body = JSON.parse(init!.body as string) as Record<string, unknown>;
      zohoContactUpserts.push({ authorization: new Headers(init?.headers).get('Authorization'), body });
      return new Response(JSON.stringify({ data: [{ status: 'success', code: 'SUCCESS', details: { id: `zoho-contact-${zohoContactUpserts.length}` } }] }), { status: 200 });
    }

    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'mock-access-token', expires_in: 3600 }), { status: 200 });
    }
    if (url === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
    }
    if (url.startsWith(databaseUrl)) {
      const path = url.slice(databaseUrl.length + 1).replace(/\.json.*$/, '');
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        // path === '' is the database-root export (Phase15Api.backupNow) — the empty
        // string isn't a real segment to walk into, it means "return the whole store".
        let node: unknown = store;
        if (path !== '') {
          for (const seg of path.split('/')) node = (node as Record<string, unknown> | undefined)?.[seg];
        }
        return new Response(node === undefined ? 'null' : JSON.stringify(node), { status: 200 });
      }
      if (method === 'PUT') {
        const segments = path.split('/');
        const id = segments.pop()!;
        const collection = segments.join('/');
        store[collection] = store[collection] ?? {};
        store[collection]![id] = JSON.parse(init!.body as string);
        return new Response(init!.body as string, { status: 200 });
      }
      if (method === 'DELETE') {
        const segments = path.split('/');
        const id = segments.pop()!;
        const collection = segments.join('/');
        delete store[collection]?.[id];
        return new Response('null', { status: 200 });
      }
    }
    throw new Error(`mockFirebase: unexpected fetch to ${url}`);
  }) as typeof fetch;

  return {
    serviceAccount,
    databaseUrl,
    store,
    signIdToken,
    exotelConfig,
    exotelCalls,
    setNextExotelResponse: (status: number, body: unknown) => { nextExotelResponse = { status, body }; },
    exotelVoiceConfig,
    exotelVoiceCalls,
    setNextExotelVoiceResponse: (status: number, body: unknown) => { nextExotelVoiceResponse = { status, body }; },
    emailEnv,
    resendCalls,
    setNextResendResponse: (status: number, body: unknown) => { nextResendResponse = { status, body }; },
    metaAdsEnv,
    metaAdsCalls,
    setNextMetaAdsResponse: (status: number, body: unknown) => { nextMetaAdsResponse = { status, body }; },
    zohoEnv,
    zohoContactUpserts,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

/**
 * Firebase Admin access from a Cloudflare Worker.
 *
 * Workers can't use the Node Firebase Admin SDK (it assumes Node's `crypto`
 * module and long-lived process state) or google-auth-library (same problem).
 * This hand-signs the two JWT flows Firebase Admin needs using the Workers
 * runtime's native Web Crypto API instead — the same approach the Apps
 * Script build used via `Utilities.computeRsaSha256Signature`, just with the
 * standard browser-style crypto API instead of Apps Script's `Utilities`.
 *
 * Two separate JWTs, two separate audiences:
 *  - signServiceAccountJwt(): OAuth2 service-account flow, exchanged for a
 *    bearer access token used to call the Realtime Database REST API with
 *    full admin access (bypasses security rules) — used for every read/write
 *    this backend does on the client's behalf.
 *  - mintCustomToken(): a Firebase Auth custom token, handed to the browser
 *    so it can sign in and open a *direct*, security-rules-scoped connection
 *    to Realtime Database for live streaming — the browser never gets the
 *    admin token, only ever gets a token scoped to exactly what the signed-in
 *    user is allowed to see (see the `claims` argument).
 */

export interface FirebaseServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(value: string): string {
  return base64UrlEncode(new TextEncoder().encode(value));
}

/** Parses a PEM-formatted PKCS8 private key (as stored in a Firebase service account JSON) into an importable key. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function signJwt(serviceAccount: FirebaseServiceAccount, claims: Record<string, unknown>): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const signingInput = base64UrlEncodeString(JSON.stringify(header)) + '.' + base64UrlEncodeString(JSON.stringify(claims));
  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  return signingInput + '.' + base64UrlEncode(signature);
}

// Module-scope cache: persists across requests on a warm Worker isolate (the
// same benefit Phase2SheetCache_/FirebaseReadCache_ gave the Apps Script
// build), but never assumed to survive a cold start — always re-checked.
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/** OAuth2 access token for calling the Realtime Database REST API with full admin access. */
export async function getAccessToken(serviceAccount: FirebaseServiceAccount): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30_000) return cachedAccessToken.token;

  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwt(serviceAccount, {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Firebase OAuth2 token exchange failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

/** A Firebase Auth custom token scoped by `claims`, handed to a signed-in browser for a direct realtime connection — mirrors RealtimeListenServices.gs's mintCustomToken_. */
export async function mintCustomToken(serviceAccount: FirebaseServiceAccount, uid: string, claims: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(serviceAccount, {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
    claims,
  });
}

export class FirebaseDb {
  constructor(public readonly serviceAccount: FirebaseServiceAccount, public readonly databaseUrl: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getAccessToken(this.serviceAccount);
    const res = await fetch(`${this.databaseUrl}/${path}.json`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Firebase request failed (${res.status}) ${method} ${path}: ${await res.text()}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : (null as T);
  }

  get<T>(path: string) { return this.request<T | null>('GET', path); }
  put<T>(path: string, data: T) { return this.request<T>('PUT', path, data); }
  patch<T>(path: string, data: Partial<T>) { return this.request<T>('PATCH', path, data); }
  delete(path: string) { return this.request<null>('DELETE', path); }

  /** All records at a collection path, as an array (Realtime Database stores them as an object keyed by id). */
  async list<T>(collection: string): Promise<T[]> {
    const data = await this.get<Record<string, T>>(collection);
    return data ? Object.values(data) : [];
  }
}

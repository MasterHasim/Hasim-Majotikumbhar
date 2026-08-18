/**
 * Verifies Firebase ID tokens sent by the frontend (Authorization: Bearer <token>),
 * without the Firebase Admin SDK (Workers-incompatible — see firebaseAdmin.ts).
 * Uses Google's public JWK set directly via Web Crypto, same trust chain the
 * Admin SDK itself would use.
 */

interface DecodedIdToken {
  uid: string;
  email: string | null;
  claims: Record<string, unknown>;
}

interface CachedKeys {
  keys: Record<string, CryptoKey>;
  expiresAt: number;
}

let cachedKeys: CachedKeys | null = null;

/** Test-only: each test mocks a fresh "Google" with its own throwaway keypair, so the 5-minute production cache (correct in real deployments, where Google's actual keys don't rotate that often) must not survive between test cases. */
export function __resetKeyCacheForTests(): void {
  cachedKeys = null;
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(value))) as T;
}

/** TS's built-in JsonWebKey type omits `kid` (RFC 7517 defines it as an optional member, but every real JWK response includes it). */
type JsonWebKeyWithId = JsonWebKey & { kid: string };

async function getGooglePublicKeys(): Promise<Record<string, CryptoKey>> {
  if (cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;

  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw new Error('Could not fetch Google public keys for ID token verification');
  const data = (await res.json()) as { keys: JsonWebKeyWithId[] };

  const keys: Record<string, CryptoKey> = {};
  for (const jwk of data.keys) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (jwk.kid) keys[jwk.kid] = key;
  }
  // Google's Cache-Control header dictates real rotation timing; a conservative
  // fixed re-fetch window is simpler and still cheap (this endpoint is free/public).
  cachedKeys = { keys, expiresAt: Date.now() + 5 * 60_000 };
  return keys;
}

/** Verifies a Firebase ID token, throwing on any failure. Returns the signed-in user's uid, email, and custom claims (e.g. numberIds/role set via the admin backend). */
export async function verifyIdToken(idToken: string, projectId: string): Promise<DecodedIdToken> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const header = base64UrlDecodeToJson<{ kid?: string; alg: string }>(headerB64);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unexpected ID token header');

  const keys = await getGooglePublicKeys();
  const key = keys[header.kid];
  if (!key) throw new Error('Unknown signing key (kid not found in Google public key set)');

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signingInput);
  if (!valid) throw new Error('ID token signature verification failed');

  const payload = base64UrlDecodeToJson<Record<string, unknown> & { sub: string; aud: string; iss: string; exp: number; iat: number; email?: string }>(payloadB64);
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error('ID token audience mismatch');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('ID token issuer mismatch');
  if (payload.exp < now) throw new Error('ID token expired');
  if (payload.iat > now + 60) throw new Error('ID token issued in the future');

  return { uid: payload.sub, email: payload.email ?? null, claims: payload };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

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

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

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
        const segments = path.split('/');
        let node: unknown = store;
        for (const seg of segments) node = (node as Record<string, unknown> | undefined)?.[seg];
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
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

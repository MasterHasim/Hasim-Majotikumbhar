import { auth } from './firebase';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Calls the Workers backend, attaching the signed-in user's Firebase ID token. Throws ApiClientError on any non-2xx response. */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  const idToken = user ? await user.getIdToken() : null;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...options.headers,
    },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiClientError(res.status, body?.code ?? 'UNKNOWN_ERROR', body?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

/** Minimal in-memory fake implementing exactly the KVNamespace surface kvCache.ts uses
 * (get/put/delete) -- same "faithfully replicate just the real usage" spirit as mockD1.ts. */
export interface MockKvContext {
  kv: KVNamespace;
  store: Map<string, string>;
  putCalls: { key: string; value: string; ttlSeconds?: number }[];
}

export function setupMockKv(): MockKvContext {
  const store = new Map<string, string>();
  const putCalls: { key: string; value: string; ttlSeconds?: number }[] = [];

  const kv = {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, value);
      putCalls.push({ key, value, ttlSeconds: opts?.expirationTtl });
    },
    delete: async (key: string) => { store.delete(key); },
  } as unknown as KVNamespace;

  return { kv, store, putCalls };
}

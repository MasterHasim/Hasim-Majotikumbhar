/**
 * Free-tier edge cache (Cloudflare Workers KV) for a small, deliberately narrow set of
 * collections: low security risk if briefly stale, rarely written, read on nearly every page
 * load (lead stages, quick replies, custom field definitions — never roles/permissions, which
 * stay on the existing per-request-only cache in accessControl.ts since a stale permission
 * grant is a real security concern, not just a UX one).
 *
 * Read-through with a moderate TTL as a safety net, but freshness in practice comes from
 * `invalidate` being called by every create/update/delete on a cached collection — a KV miss
 * (cold cache, or right after an invalidation) just falls through to the real Firebase read, so
 * this can never make data MORE stale than it already was, only skip a redundant read.
 * `kv` is optional everywhere: a test environment or a request that somehow lacks the binding
 * degrades to "no caching," never a hard failure — see types.ts's Env.CONFIG_CACHE doc comment.
 */

const DEFAULT_TTL_SECONDS = 300;

export async function cachedList<T>(kv: KVNamespace | undefined, cacheKey: string, fetcher: () => Promise<T[]>, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<T[]> {
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached !== null) return JSON.parse(cached) as T[];
    } catch (err) {
      console.error(`kvCache: read failed for '${cacheKey}', falling back to source`, err);
    }
  }
  const fresh = await fetcher();
  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify(fresh), { expirationTtl: ttlSeconds });
    } catch (err) {
      console.error(`kvCache: write failed for '${cacheKey}'`, err);
    }
  }
  return fresh;
}

export async function invalidateCache(kv: KVNamespace | undefined, cacheKey: string): Promise<void> {
  if (!kv) return;
  try {
    await kv.delete(cacheKey);
  } catch (err) {
    console.error(`kvCache: invalidate failed for '${cacheKey}'`, err);
  }
}

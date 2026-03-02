export const BASE_URL = "/api";

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    // Try to extract the server's error message (and optional detail) from the JSON body
    let serverMessage: string | undefined;
    let serverDetail: string | undefined;
    try {
      const body = await res.json() as { error?: string; detail?: string };
      serverMessage = body.error;
      serverDetail = body.detail;
    } catch {
      // Response wasn't JSON — fall back to status text
    }
    const err = new Error(serverMessage || `API error: ${res.status} ${res.statusText}`);
    if (serverDetail) (err as Error & { detail?: string }).detail = serverDetail;
    throw err;
  }
  return res.json() as Promise<T>;
}

// --- Request deduplication + TTL cache ---
// Prevents N+1 fetches when multiple components request the same endpoint.
// In-flight requests are shared; resolved values are cached for `ttl` ms.

const _cache = new Map<string, { data: unknown; ts: number }>();
const _inflight = new Map<string, Promise<unknown>>();

export function cachedFetch<T>(key: string, fn: () => Promise<T>, ttl: number): Promise<T> {
  // Return cached value if still fresh
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < ttl) {
    return Promise.resolve(cached.data as T);
  }
  // Deduplicate in-flight requests
  const existing = _inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fn().then((data) => {
    _cache.set(key, { data, ts: Date.now() });
    _inflight.delete(key);
    return data;
  }).catch((err) => {
    _inflight.delete(key);
    throw err;
  });
  _inflight.set(key, promise);
  return promise;
}

/** Invalidate a cached endpoint so the next call re-fetches. */
export function invalidateCache(key: string) {
  _cache.delete(key);
}

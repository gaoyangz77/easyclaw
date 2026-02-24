import { fetchJson, cachedFetch, invalidateCache } from "./client.js";

// --- Provider Keys ---

export interface ProviderKeyEntry {
  id: string;
  provider: string;
  label: string;
  model: string;
  isDefault: boolean;
  proxyUrl?: string;
  authType?: "api_key" | "oauth" | "local";
  baseUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchProviderKeys(): Promise<ProviderKeyEntry[]> {
  return cachedFetch("provider-keys", async () => {
    const data = await fetchJson<{ keys: ProviderKeyEntry[] }>("/provider-keys");
    return data.keys;
  }, 5000);
}

export async function createProviderKey(data: {
  provider: string;
  label: string;
  model: string;
  apiKey?: string;
  proxyUrl?: string;
  authType?: "api_key" | "oauth" | "local";
  baseUrl?: string;
}): Promise<ProviderKeyEntry> {
  const result = await fetchJson<ProviderKeyEntry>("/provider-keys", {
    method: "POST",
    body: JSON.stringify(data),
  });
  invalidateCache("provider-keys");
  return result;
}

export async function updateProviderKey(
  id: string,
  fields: { label?: string; model?: string; proxyUrl?: string; baseUrl?: string },
): Promise<ProviderKeyEntry> {
  const result = await fetchJson<ProviderKeyEntry>("/provider-keys/" + id, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
  invalidateCache("provider-keys");
  return result;
}

export async function activateProviderKey(id: string): Promise<void> {
  await fetchJson("/provider-keys/" + id + "/activate", { method: "POST" });
  invalidateCache("provider-keys");
}

export async function deleteProviderKey(id: string): Promise<void> {
  await fetchJson("/provider-keys/" + id, { method: "DELETE" });
  invalidateCache("provider-keys");
}

// --- Local Models ---

export interface LocalModelServer {
  type: "ollama" | "lmstudio" | "vllm" | "custom";
  baseUrl: string;
  version?: string;
  status: "detected" | "offline";
}

export async function detectLocalModels(): Promise<LocalModelServer[]> {
  const data = await fetchJson<{ servers: LocalModelServer[] }>("/local-models/detect");
  return data.servers;
}

export async function fetchLocalModels(baseUrl: string): Promise<Array<{ id: string; name: string }>> {
  const data = await fetchJson<{ models: Array<{ id: string; name: string }> }>(
    "/local-models/models?baseUrl=" + encodeURIComponent(baseUrl),
  );
  return data.models;
}

export async function checkLocalModelHealth(baseUrl: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  return fetchJson<{ ok: boolean; version?: string; error?: string }>(
    "/local-models/health",
    { method: "POST", body: JSON.stringify({ baseUrl }) },
  );
}

// --- OAuth Flow ---

export async function startOAuthFlow(
  provider: string,
): Promise<{ email?: string; tokenPreview?: string; providerKeyId?: string; provider?: string; manualMode?: boolean; authUrl?: string }> {
  const result = await fetchJson<{ ok: boolean; email?: string; tokenPreview?: string; providerKeyId?: string; provider?: string; manualMode?: boolean; authUrl?: string }>(
    "/oauth/start",
    { method: "POST", body: JSON.stringify({ provider }) },
  );
  return result;
}

export async function completeManualOAuth(
  provider: string,
  callbackUrl: string,
): Promise<{ email?: string; tokenPreview?: string }> {
  return fetchJson("/oauth/manual-complete", {
    method: "POST",
    body: JSON.stringify({ provider, callbackUrl }),
  });
}

export async function saveOAuthFlow(
  provider: string,
  options: { proxyUrl?: string; label?: string; model?: string },
): Promise<{ providerKeyId: string; email?: string; provider: string }> {
  const result = await fetchJson<{ ok: boolean; providerKeyId: string; email?: string; provider: string }>(
    "/oauth/save",
    { method: "POST", body: JSON.stringify({ provider, ...options }) },
  );
  invalidateCache("provider-keys");
  return result;
}

// --- Model Catalog ---

export interface CatalogModelEntry {
  id: string;
  name: string;
}

/**
 * Fetch the dynamic model catalog from the gateway's models.json.
 * Returns a map of provider → model list.
 * Empty object if models.json doesn't exist yet (gateway not started).
 */
export async function fetchModelCatalog(): Promise<Record<string, CatalogModelEntry[]>> {
  return cachedFetch("models", async () => {
    const data = await fetchJson<{ models: Record<string, CatalogModelEntry[]> }>("/models");
    return data.models;
  }, 30000); // 30s — model catalog rarely changes
}

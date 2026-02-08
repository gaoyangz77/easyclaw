const BASE_URL = "http://127.0.0.1:3210/api";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error("API error: " + res.status + " " + res.statusText);
  }
  return res.json() as Promise<T>;
}

// --- Rules ---

export interface Rule {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  artifactStatus?: "ok" | "failed" | "pending";
  artifactType?: "policy-fragment" | "guard" | "action-bundle";
}

export async function fetchRules(): Promise<Rule[]> {
  const data = await fetchJson<{ rules: Rule[] }>("/rules");
  return data.rules;
}

export async function createRule(text: string): Promise<Rule> {
  return fetchJson<Rule>("/rules", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function updateRule(id: string, text: string): Promise<Rule> {
  return fetchJson<Rule>("/rules/" + id, {
    method: "PUT",
    body: JSON.stringify({ text }),
  });
}

export async function deleteRule(id: string): Promise<void> {
  await fetchJson("/rules/" + id, { method: "DELETE" });
}

// --- Settings ---

export async function fetchSettings(): Promise<Record<string, string>> {
  const data = await fetchJson<{ settings: Record<string, string> }>("/settings");
  return data.settings;
}

export async function updateSettings(settings: Record<string, string>): Promise<void> {
  await fetchJson("/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export async function validateApiKey(
  provider: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<{ valid: boolean; error?: string }> {
  return fetchJson("/settings/validate-key", {
    method: "POST",
    body: JSON.stringify({ provider, apiKey, proxyUrl }),
  });
}

// --- Provider Keys ---

export interface ProviderKeyEntry {
  id: string;
  provider: string;
  label: string;
  model: string;
  isDefault: boolean;
  proxyUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchProviderKeys(): Promise<ProviderKeyEntry[]> {
  const data = await fetchJson<{ keys: ProviderKeyEntry[] }>("/provider-keys");
  return data.keys;
}

export async function createProviderKey(data: {
  provider: string;
  label: string;
  model: string;
  apiKey: string;
  proxyUrl?: string;
}): Promise<ProviderKeyEntry> {
  return fetchJson<ProviderKeyEntry>("/provider-keys", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateProviderKey(
  id: string,
  fields: { label?: string; model?: string; proxyUrl?: string },
): Promise<ProviderKeyEntry> {
  return fetchJson<ProviderKeyEntry>("/provider-keys/" + id, {
    method: "PUT",
    body: JSON.stringify(fields),
  });
}

export async function activateProviderKey(id: string): Promise<void> {
  await fetchJson("/provider-keys/" + id + "/activate", { method: "POST" });
}

export async function deleteProviderKey(id: string): Promise<void> {
  await fetchJson("/provider-keys/" + id, { method: "DELETE" });
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
  const data = await fetchJson<{ models: Record<string, CatalogModelEntry[]> }>("/models");
  return data.models;
}

// --- Channels ---

/**
 * Legacy channel interface (SQLite-backed, not used in Phase 1)
 * @deprecated Use fetchChannelStatus instead
 */
export interface Channel {
  id: string;
  channelType: string;
  enabled: boolean;
  accountId: string;
  settings: Record<string, unknown>;
}

/**
 * OpenClaw channels status snapshot types
 */
export interface ChannelAccountSnapshot {
  accountId: string;
  name?: string | null;
  enabled?: boolean | null;
  configured?: boolean | null;
  linked?: boolean | null;
  running?: boolean | null;
  connected?: boolean | null;
  lastError?: string | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  mode?: string | null;
  dmPolicy?: string | null;
  groupPolicy?: string | null;
  streamMode?: string | null;
  webhookUrl?: string | null;
  probe?: unknown;
}

export interface ChannelsStatusSnapshot {
  ts: number;
  channelOrder: string[];
  channelLabels: Record<string, string>;
  channelMeta?: Array<{ id: string; label: string; detailLabel: string }>;
  channels: Record<string, unknown>;
  channelAccounts: Record<string, ChannelAccountSnapshot[]>;
  channelDefaultAccountId: Record<string, string>;
}

/**
 * Fetch real-time channel status from OpenClaw gateway via RPC.
 * @param probe - If true, trigger health checks for all channels
 */
export async function fetchChannelStatus(probe = false): Promise<ChannelsStatusSnapshot | null> {
  const data = await fetchJson<{ snapshot: ChannelsStatusSnapshot | null; error?: string }>(
    `/channels/status?probe=${probe}`
  );
  if (data.error) {
    console.warn("Failed to fetch channel status:", data.error);
  }
  return data.snapshot;
}

/**
 * @deprecated Legacy SQLite-backed channels (Phase 0). Use fetchChannelStatus instead.
 */
export async function fetchChannels(): Promise<Channel[]> {
  const data = await fetchJson<{ channels: Channel[] }>("/channels");
  return data.channels;
}

/**
 * @deprecated Legacy SQLite-backed channels (Phase 0). Use OpenClaw config instead.
 */
export async function createChannel(channel: Omit<Channel, "id">): Promise<Channel> {
  return fetchJson<Channel>("/channels", {
    method: "POST",
    body: JSON.stringify(channel),
  });
}

/**
 * @deprecated Legacy SQLite-backed channels (Phase 0). Use OpenClaw config instead.
 */
export async function deleteChannel(id: string): Promise<void> {
  await fetchJson("/channels/" + id, { method: "DELETE" });
}

/**
 * Create a new channel account in OpenClaw config.
 */
export async function createChannelAccount(data: {
  channelId: string;
  accountId: string;
  name?: string;
  config: Record<string, unknown>;
  secrets?: Record<string, string>;
}): Promise<{ ok: boolean; channelId: string; accountId: string }> {
  return fetchJson("/channels/accounts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Update an existing channel account in OpenClaw config.
 */
export async function updateChannelAccount(
  channelId: string,
  accountId: string,
  data: {
    name?: string;
    config: Record<string, unknown>;
    secrets?: Record<string, string>;
  }
): Promise<{ ok: boolean; channelId: string; accountId: string }> {
  return fetchJson(`/channels/accounts/${channelId}/${accountId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/**
 * Delete a channel account from OpenClaw config.
 */
export async function deleteChannelAccount(
  channelId: string,
  accountId: string
): Promise<{ ok: boolean; channelId: string; accountId: string }> {
  return fetchJson(`/channels/accounts/${channelId}/${accountId}`, {
    method: "DELETE",
  });
}

// --- Permissions ---

export interface Permissions {
  readPaths: string[];
  writePaths: string[];
}

export async function fetchPermissions(): Promise<Permissions> {
  const data = await fetchJson<{ permissions: Permissions }>("/permissions");
  return data.permissions;
}

export async function updatePermissions(permissions: Permissions): Promise<void> {
  await fetchJson("/permissions", {
    method: "PUT",
    body: JSON.stringify(permissions),
  });
}

export async function fetchWorkspacePath(): Promise<string> {
  const data = await fetchJson<{ workspacePath: string }>("/workspace");
  return data.workspacePath;
}

// --- File Dialog ---

export async function openFileDialog(): Promise<string | null> {
  const data = await fetchJson<{ path: string | null }>("/file-dialog", {
    method: "POST",
  });
  return data.path;
}

// --- Status ---

export interface GatewayStatus {
  status: string;
  ruleCount: number;
  artifactCount: number;
}

export async function fetchStatus(): Promise<GatewayStatus> {
  return fetchJson<GatewayStatus>("/status");
}

// --- Usage ---

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  recordCount: number;
  byModel: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      count: number;
    }
  >;
  byProvider: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      count: number;
    }
  >;
}

export async function fetchUsage(
  filter?: { since?: string; until?: string; model?: string; provider?: string },
): Promise<UsageSummary> {
  const params = new URLSearchParams();
  if (filter?.since) params.set("since", filter.since);
  if (filter?.until) params.set("until", filter.until);
  if (filter?.model) params.set("model", filter.model);
  if (filter?.provider) params.set("provider", filter.provider);
  const query = params.toString();
  return fetchJson<UsageSummary>("/usage" + (query ? "?" + query : ""));
}

// --- Telemetry Settings ---

export async function fetchTelemetrySetting(): Promise<boolean> {
  const data = await fetchJson<{ enabled: boolean }>("/settings/telemetry");
  return data.enabled;
}

export async function updateTelemetrySetting(enabled: boolean): Promise<void> {
  await fetchJson("/settings/telemetry", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

// --- Pairing ---

export interface PairingRequest {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt: string;
  meta?: Record<string, string>;
}

export async function fetchPairingRequests(channelId: string): Promise<PairingRequest[]> {
  const data = await fetchJson<{ requests: PairingRequest[] }>(`/pairing/requests/${channelId}`);
  return data.requests;
}

export async function fetchAllowlist(channelId: string): Promise<string[]> {
  const data = await fetchJson<{ allowlist: string[] }>(`/pairing/allowlist/${channelId}`);
  return data.allowlist;
}

export async function approvePairing(channelId: string, code: string): Promise<{ id: string }> {
  const data = await fetchJson<{ id: string }>("/pairing/approve", {
    method: "POST",
    body: JSON.stringify({ channelId, code }),
  });
  return data;
}

export async function removeFromAllowlist(channelId: string, entry: string): Promise<void> {
  await fetchJson(`/pairing/allowlist/${channelId}/${encodeURIComponent(entry)}`, {
    method: "DELETE",
  });
}

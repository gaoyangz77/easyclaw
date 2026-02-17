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

// --- Request deduplication + TTL cache ---
// Prevents N+1 fetches when multiple components request the same endpoint.
// In-flight requests are shared; resolved values are cached for `ttl` ms.

const _cache = new Map<string, { data: unknown; ts: number }>();
const _inflight = new Map<string, Promise<unknown>>();

function cachedFetch<T>(key: string, fn: () => Promise<T>, ttl: number): Promise<T> {
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
function invalidateCache(key: string) {
  _cache.delete(key);
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
  return cachedFetch("rules", async () => {
    const data = await fetchJson<{ rules: Rule[] }>("/rules");
    return data.rules;
  }, 3000);
}

export async function createRule(text: string): Promise<Rule> {
  const result = await fetchJson<Rule>("/rules", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  invalidateCache("rules");
  return result;
}

export async function updateRule(id: string, text: string): Promise<Rule> {
  const result = await fetchJson<Rule>("/rules/" + id, {
    method: "PUT",
    body: JSON.stringify({ text }),
  });
  invalidateCache("rules");
  return result;
}

export async function deleteRule(id: string): Promise<void> {
  await fetchJson("/rules/" + id, { method: "DELETE" });
  invalidateCache("rules");
}

// --- Settings ---

export async function fetchSettings(): Promise<Record<string, string>> {
  return cachedFetch("settings", async () => {
    const data = await fetchJson<{ settings: Record<string, string> }>("/settings");
    return data.settings;
  }, 5000);
}

export async function updateSettings(settings: Record<string, string>): Promise<void> {
  await fetchJson("/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  invalidateCache("settings");
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
  authType?: "api_key" | "oauth";
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
  apiKey: string;
  proxyUrl?: string;
  authType?: "api_key" | "oauth";
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
  fields: { label?: string; model?: string; proxyUrl?: string },
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

// --- OAuth Flow ---

export async function startOAuthFlow(
  provider: string,
): Promise<{ email?: string; tokenPreview?: string; providerKeyId?: string; provider?: string }> {
  const result = await fetchJson<{ ok: boolean; email?: string; tokenPreview?: string; providerKeyId?: string; provider?: string }>(
    "/oauth/start",
    { method: "POST", body: JSON.stringify({ provider }) },
  );
  return result;
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

// --- Per-Key/Model Usage ---

export interface KeyModelUsageSummary {
  keyId: string;
  keyLabel: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCostUsd: string;
  authType: "api_key" | "oauth";
}

export interface ActiveKeyInfo {
  keyId: string;
  keyLabel: string;
  provider: string;
  model: string;
  authType: "api_key" | "oauth";
}

export async function fetchKeyUsage(filter?: {
  windowStart?: number;
  windowEnd?: number;
  keyId?: string;
  provider?: string;
  model?: string;
}): Promise<KeyModelUsageSummary[]> {
  const params = new URLSearchParams();
  if (filter?.windowStart) params.set("windowStart", String(filter.windowStart));
  if (filter?.windowEnd) params.set("windowEnd", String(filter.windowEnd));
  if (filter?.keyId) params.set("keyId", filter.keyId);
  if (filter?.provider) params.set("provider", filter.provider);
  if (filter?.model) params.set("model", filter.model);
  const query = params.toString();
  return fetchJson<KeyModelUsageSummary[]>("/key-usage" + (query ? "?" + query : ""));
}

export async function fetchActiveKeyUsage(): Promise<ActiveKeyInfo | null> {
  return fetchJson<ActiveKeyInfo | null>("/key-usage/active");
}

export interface KeyUsageDailyBucket {
  keyId: string;
  keyLabel: string;
  provider: string;
  model: string;
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: string;
}

export async function fetchKeyUsageTimeseries(filter?: {
  windowStart?: number;
  windowEnd?: number;
}): Promise<KeyUsageDailyBucket[]> {
  const params = new URLSearchParams();
  if (filter?.windowStart) params.set("windowStart", String(filter.windowStart));
  if (filter?.windowEnd) params.set("windowEnd", String(filter.windowEnd));
  const query = params.toString();
  return fetchJson<KeyUsageDailyBucket[]>("/key-usage/timeseries" + (query ? "?" + query : ""));
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

// --- Telemetry Event Tracking ---

/** Fire-and-forget telemetry event relay to desktop main process. */
export function trackEvent(eventType: string, metadata?: Record<string, unknown>): void {
  fetch(BASE_URL + "/telemetry/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventType, metadata }),
  }).catch(() => {});
}

// --- App Update ---

export interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  downloadUrl: string | null;
  releaseNotes: string | null;
}

export async function fetchUpdateInfo(): Promise<UpdateInfo> {
  return fetchJson<UpdateInfo>("/app/update");
}

export interface UpdateDownloadStatus {
  status: "idle" | "downloading" | "verifying" | "ready" | "installing" | "error";
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  filePath?: string;
  message?: string;
}

export async function startUpdateDownload(): Promise<void> {
  await fetchJson("/app/update/download", { method: "POST" });
}

export async function cancelUpdateDownload(): Promise<void> {
  await fetchJson("/app/update/cancel", { method: "POST" });
}

export async function fetchUpdateDownloadStatus(): Promise<UpdateDownloadStatus> {
  return fetchJson<UpdateDownloadStatus>("/app/update/download-status");
}

export async function triggerUpdateInstall(): Promise<void> {
  await fetchJson("/app/update/install", { method: "POST" });
}

// --- Changelog ---

export interface ChangelogEntry {
  version: string;
  date: string;
  en: string[];
  zh: string[];
}

export async function fetchChangelog(): Promise<{
  currentVersion: string | null;
  entries: ChangelogEntry[];
}> {
  return cachedFetch("changelog", async () => {
    return fetchJson("/app/changelog");
  }, 86_400_000); // 24h — only changes on app update
}

// --- Gateway Info ---

export interface GatewayInfo {
  wsUrl: string;
  token?: string;
}

export async function fetchGatewayInfo(): Promise<GatewayInfo> {
  return fetchJson<GatewayInfo>("/app/gateway-info");
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

export async function approvePairing(channelId: string, code: string, locale?: string): Promise<{ id: string }> {
  const data = await fetchJson<{ id: string }>("/pairing/approve", {
    method: "POST",
    body: JSON.stringify({ channelId, code, locale }),
  });
  return data;
}

export async function removeFromAllowlist(channelId: string, entry: string): Promise<void> {
  await fetchJson(`/pairing/allowlist/${channelId}/${encodeURIComponent(entry)}`, {
    method: "DELETE",
  });
}

// --- Pricing (cloud backend) ---

export interface ModelPricing {
  modelId: string;
  displayName: string;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
  note?: string;
}

export interface PlanDetail {
  modelName: string;
  volume: string;
}

export interface Plan {
  planName: string;
  price: string;
  currency: string;
  planDetail: PlanDetail[];
}

export interface ProviderSubscription {
  id: string;
  label: string;
  pricingUrl: string;
  plans: Plan[];
}

export interface ProviderPricing {
  provider: string;
  currency: string;
  pricingUrl: string;
  models: ModelPricing[];
  subscriptions?: ProviderSubscription[];
}

function getPricingApiUrl(language: string): string {
  return language === "zh"
    ? "https://api-cn.easy-claw.com/graphql"
    : "https://api.easy-claw.com/graphql";
}

/**
 * Fetch model pricing data from the cloud backend.
 * Returns null if the server is unreachable (graceful degradation).
 */
export async function fetchPricing(
  deviceId: string,
  platform: string,
  appVersion: string,
  language: string,
): Promise<ProviderPricing[] | null> {
  return cachedFetch("pricing", async () => {
    try {
      const res = await fetch(getPricingApiUrl(language), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query($deviceId: String!, $platform: String!, $appVersion: String!, $language: String!) {
            pricing(deviceId: $deviceId, platform: $platform, appVersion: $appVersion, language: $language) {
              provider currency pricingUrl
              models { modelId displayName inputPricePerMillion outputPricePerMillion note }
              subscriptions { id label pricingUrl plans { planName price currency planDetail { modelName volume } } }
            }
          }`,
          variables: { deviceId, platform, appVersion, language },
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json.data?.pricing ?? null;
    } catch {
      return null;
    }
  }, 14_400_000); // 4h — pricing rarely changes
}

// --- WeCom Channel ---

export type WeComBindingStatus = "pending" | "bound" | "active" | "error";

export interface WeComBindingStatusResponse {
  status: WeComBindingStatus | null;
  relayUrl?: string;
  externalUserId?: string;
  connected?: boolean;
  bindingToken?: string;
  customerServiceUrl?: string;
}

export async function fetchWeComBindingStatus(): Promise<WeComBindingStatusResponse> {
  return fetchJson<WeComBindingStatusResponse>("/channels/wecom/binding-status");
}

export async function bindWeComAccount(relayUrl: string, authToken: string): Promise<{ ok: boolean; bindingToken?: string; customerServiceUrl?: string }> {
  return fetchJson("/channels/wecom/bind", {
    method: "POST",
    body: JSON.stringify({ relayUrl, authToken }),
  });
}

export async function unbindWeComAccount(): Promise<{ ok: boolean }> {
  return fetchJson("/channels/wecom/unbind", {
    method: "DELETE",
  });
}

// --- Skills Marketplace ---

export interface MarketSkill {
  slug: string;
  name_en: string;
  name_zh: string;
  desc_en: string;
  desc_zh: string;
  author: string;
  version: string;
  tags: string[];
  labels: string[];
  chinaAvailable: boolean;
  stars: number;
  downloads: number;
  hidden: boolean;
}

export interface InstalledSkill {
  slug: string;
  name: string;
  description: string;
  author: string;
  version: string;
  filePath: string;
  installedAt: string;
}

export interface SkillCategory {
  id: string;
  name_en: string;
  name_zh: string;
  count: number;
}

export interface MarketResponse {
  skills: MarketSkill[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchMarketSkills(params?: {
  query?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  chinaAvailable?: boolean;
  lang?: string;
}): Promise<MarketResponse> {
  const qs = new URLSearchParams();
  if (params?.query) qs.set("query", params.query);
  if (params?.category) qs.set("category", params.category);
  if (params?.page) qs.set("page", String(params.page));
  if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params?.chinaAvailable !== undefined) qs.set("chinaAvailable", String(params.chinaAvailable));
  if (params?.lang) qs.set("lang", params.lang);
  const q = qs.toString();
  return fetchJson<MarketResponse>("/skills/market" + (q ? "?" + q : ""));
}

export async function fetchInstalledSkills(): Promise<InstalledSkill[]> {
  return cachedFetch("installed-skills", async () => {
    const data = await fetchJson<{ skills: InstalledSkill[] }>("/skills/installed");
    return data.skills;
  }, 5000);
}

export async function installSkill(
  slug: string,
  lang?: string,
  meta?: { name?: string; description?: string; author?: string; version?: string },
): Promise<{ ok: boolean; error?: string }> {
  const result = await fetchJson<{ ok: boolean; error?: string }>("/skills/install", {
    method: "POST",
    body: JSON.stringify({ slug, lang, meta }),
  });
  invalidateCache("installed-skills");
  return result;
}

export async function deleteSkill(slug: string): Promise<{ ok: boolean; error?: string }> {
  const result = await fetchJson<{ ok: boolean; error?: string }>("/skills/delete", {
    method: "POST",
    body: JSON.stringify({ slug }),
  });
  invalidateCache("installed-skills");
  return result;
}

export async function openSkillsFolder(): Promise<void> {
  await fetchJson("/skills/open-folder", { method: "POST" });
}

export async function fetchBundledSlugs(): Promise<Set<string>> {
  return cachedFetch("bundled-slugs", async () => {
    const data = await fetchJson<{ slugs: string[] }>("/skills/bundled-slugs");
    return new Set(data.slugs);
  }, 60_000);
}

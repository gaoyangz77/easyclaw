import { fetchJson, cachedFetch } from "./client.js";

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

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

// --- Channels ---

export interface Channel {
  id: string;
  channelType: string;
  enabled: boolean;
  accountId: string;
  settings: Record<string, unknown>;
}

export async function fetchChannels(): Promise<Channel[]> {
  const data = await fetchJson<{ channels: Channel[] }>("/channels");
  return data.channels;
}

export async function updateChannels(channels: Channel[]): Promise<void> {
  await fetchJson("/channels", {
    method: "PUT",
    body: JSON.stringify({ channels }),
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

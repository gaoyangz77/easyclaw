import { fetchJson, cachedFetch, invalidateCache, BASE_URL } from "./client.js";

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

// --- Auto-Launch Settings ---

export async function fetchAutoLaunchSetting(): Promise<boolean> {
  const data = await fetchJson<{ enabled: boolean }>("/settings/auto-launch");
  return data.enabled;
}

export async function updateAutoLaunchSetting(enabled: boolean): Promise<void> {
  await fetchJson("/settings/auto-launch", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

// --- Chat Settings ---

export async function fetchChatShowAgentEvents(): Promise<boolean> {
  const settings = await fetchSettings();
  return settings["chat_show_agent_events"] !== "false";
}

export async function updateChatShowAgentEvents(enabled: boolean): Promise<void> {
  await updateSettings({ chat_show_agent_events: enabled ? "true" : "false" });
  invalidateCache("settings");
}

export async function fetchChatPreserveToolEvents(): Promise<boolean> {
  const settings = await fetchSettings();
  return settings["chat_preserve_tool_events"] === "true";
}

export async function updateChatPreserveToolEvents(enabled: boolean): Promise<void> {
  await updateSettings({ chat_preserve_tool_events: enabled ? "true" : "false" });
  invalidateCache("settings");
}

// --- Agent Settings (OpenClaw session-level config) ---

export interface AgentSettings {
  dmScope: string;
}

export async function fetchAgentSettings(): Promise<AgentSettings> {
  return fetchJson<AgentSettings>("/agent-settings");
}

export async function updateAgentSettings(data: Partial<AgentSettings>): Promise<void> {
  await fetchJson("/agent-settings", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// --- Browser Settings ---

export async function fetchBrowserMode(): Promise<"standalone" | "cdp"> {
  const settings = await fetchSettings();
  return (settings["browser-mode"] || "standalone") as "standalone" | "cdp";
}

export async function updateBrowserMode(mode: "standalone" | "cdp"): Promise<void> {
  await updateSettings({ "browser-mode": mode });
  invalidateCache("settings");
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

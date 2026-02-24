import { fetchJson } from "./client.js";

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

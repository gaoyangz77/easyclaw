import { fetchJson } from "./client.js";
import { API, clientPath } from "@rivonclaw/core/api-contract";
import type { ChannelAccountSnapshot, ChannelsStatusSnapshot } from "@rivonclaw/core";
export type { ChannelAccountSnapshot, ChannelsStatusSnapshot };

/**
 * Fetch real-time channel status from OpenClaw gateway via RPC.
 * @param probe - If true, trigger health checks for all channels
 */
export async function fetchChannelStatus(probe = false): Promise<ChannelsStatusSnapshot | null> {
  const data = await fetchJson<{ snapshot: ChannelsStatusSnapshot | null; error?: string }>(
    clientPath(API["channels.status"]) + `?probe=${probe}`
  );
  if (data.error) {
    console.warn("Failed to fetch channel status:", data.error);
  }
  return data.snapshot;
}

/**
 * Fetch a channel account's full config from SQLite (excludes secrets).
 */
export async function getChannelAccountConfig(
  channelId: string,
  accountId: string,
): Promise<{ channelId: string; accountId: string; name: string | null; config: Record<string, unknown> }> {
  return fetchJson(clientPath(API["channels.accounts.get"], { channelId, accountId }));
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
  const data = await fetchJson<{ requests: PairingRequest[] }>(clientPath(API["pairing.requests"], { channelId }));
  return data.requests;
}

export interface AllowlistResult {
  allowlist: string[];
  labels: Record<string, string>;
  owners: Record<string, boolean>;
}

export async function fetchAllowlist(channelId: string, accountId?: string): Promise<AllowlistResult> {
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return fetchJson<AllowlistResult>(clientPath(API["pairing.allowlist.get"], { channelId }) + qs);
}

export async function setRecipientLabel(channelId: string, recipientId: string, label: string): Promise<void> {
  await fetchJson(clientPath(API["pairing.allowlist.setLabel"], { channelId, recipientId }), {
    method: "PUT",
    body: JSON.stringify({ label }),
  });
}

export async function setRecipientOwner(channelId: string, recipientId: string, isOwner: boolean): Promise<void> {
  await fetchJson(clientPath(API["pairing.allowlist.setOwner"], { channelId, recipientId }), {
    method: "PUT",
    body: JSON.stringify({ isOwner }),
  });
}

export async function approvePairing(channelId: string, code: string, locale?: string): Promise<{ id: string }> {
  const data = await fetchJson<{ id: string }>(clientPath(API["pairing.approve"]), {
    method: "POST",
    body: JSON.stringify({ channelId, code, locale }),
  });
  return data;
}

export async function removeFromAllowlist(channelId: string, entry: string): Promise<void> {
  await fetchJson(clientPath(API["pairing.allowlist.remove"], { channelId, recipientId: entry }), {
    method: "DELETE",
  });
}

// --- QR Login (WeChat) ---

export async function startQrLogin(accountId?: string): Promise<{ qrDataUrl?: string; message: string }> {
  return fetchJson<{ qrDataUrl?: string; message: string }>(clientPath(API["channels.qrLogin.start"]), {
    method: "POST",
    body: JSON.stringify({ accountId }),
  });
}

export async function waitQrLogin(accountId?: string, timeoutMs?: number): Promise<{ connected: boolean; message: string; accountId?: string }> {
  return fetchJson<{ connected: boolean; message: string; accountId?: string }>(clientPath(API["channels.qrLogin.wait"]), {
    method: "POST",
    body: JSON.stringify({ accountId, timeoutMs }),
  });
}


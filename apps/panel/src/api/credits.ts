import { fetchJson } from "./client.js";
import type { AccessMode } from "@rivonclaw/core";

export interface LedgerEntry {
  id: string;
  delta: number;
  reason: "signup_bonus" | "consumption" | "recharge";
  model: string | null;
  tokens: number | null;
  created_at: string;
}

export interface CreditsInfo {
  balance: number | null;
  mode: AccessMode;
}

export function fetchCreditsInfo(): Promise<CreditsInfo> {
  return fetchJson<CreditsInfo>("/credits/balance");
}

export function fetchCreditsHistory(page = 1, limit = 20): Promise<{ entries: LedgerEntry[]; total: number }> {
  return fetchJson(`/credits/history?page=${page}&limit=${limit}`);
}

export function fetchAccessMode(): Promise<{ mode: AccessMode }> {
  return fetchJson<{ mode: AccessMode }>("/credits/mode");
}

export function setAccessMode(mode: AccessMode): Promise<{ mode: AccessMode }> {
  return fetchJson<{ mode: AccessMode }>("/credits/mode", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export function createRechargeOrder(amount: number): Promise<{ orderId: string | null; status: string; message: string }> {
  return fetchJson("/recharge/create", {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
}

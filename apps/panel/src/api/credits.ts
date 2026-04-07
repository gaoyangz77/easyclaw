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

export interface QuotaInfo {
  plan: "free" | "basic" | "pro";
  show_model: boolean;
  daily: {
    used: number;
    limit: number;
    resets_at: string;
  };
  monthly: {
    used: number;
    limit: number;
    period_end: string;
  } | null;
}

export interface SubscriptionInfo {
  id: string;
  tier: "basic" | "pro";
  tokens_monthly: number;
  tokens_used: number;
  period_end: string;
}

export function fetchQuota(): Promise<QuotaInfo> {
  return fetchJson<QuotaInfo>("/credits/quota");
}

export function fetchSubscription(): Promise<{ subscription: SubscriptionInfo | null }> {
  return fetchJson<{ subscription: SubscriptionInfo | null }>("/subscription");
}

export function createSubscription(tier: "basic" | "pro"): Promise<{ status: string; message: string }> {
  return fetchJson("/subscription/create", {
    method: "POST",
    body: JSON.stringify({ tier }),
  });
}

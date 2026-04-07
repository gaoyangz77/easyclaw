// apps/panel/src/api/credits-auth.ts
import { fetchJson } from "./client.js";

const TOKEN_KEY = "credits-token";

export function getCreditsToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setCreditsToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearCreditsToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface MeResponse {
  userId: string;
  email: string | null;
  plan: string;
}

export function apiRegister(email: string, password: string): Promise<{ token: string; userId: string }> {
  return fetchJson("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function apiLogin(email: string, password: string): Promise<{ token: string; userId: string }> {
  return fetchJson("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function apiMe(token: string): Promise<MeResponse> {
  const res = await fetch("/api/auth/me", {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<MeResponse>;
}

export interface LedgerEntry {
  id: string;
  delta: number;
  reason: "signup_bonus" | "consumption" | "recharge";
  model: string | null;
  tokens: number | null;
  created_at: string;
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

export interface CreditsClient {
  deviceAuth(deviceId: string): Promise<{ token: string; balance: number }>;
  getBalance(token: string): Promise<number>;
  getHistory(token: string, page?: number, limit?: number): Promise<{ entries: LedgerEntry[]; total: number }>;
  proxyStream(token: string, payload: unknown): Promise<Response>;
  createRechargeOrder(token: string, amount: number): Promise<{ orderId: string | null; status: string; message: string }>;
  getQuota(token: string): Promise<QuotaInfo>;
  getSubscription(token: string): Promise<{ subscription: SubscriptionInfo | null }>;
  createSubscription(token: string, tier: "basic" | "pro"): Promise<{ status: string; message: string }>;
  register(email: string, password: string): Promise<{ token: string; userId: string }>;
  login(email: string, password: string): Promise<{ token: string; userId: string }>;
  me(token: string): Promise<{ userId: string; email: string | null; plan: string }>;
}

async function apiRequest<T>(
  baseUrl: string,
  path: string,
  init: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, ...fetchInit } = init;
  const headers: Record<string, string> = {};
  if (fetchInit.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    ...fetchInit,
    headers: { ...(fetchInit.headers as Record<string, string> | undefined), ...headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function createCreditsClient(baseUrl: string): CreditsClient {
  return {
    deviceAuth(deviceId) {
      return apiRequest(baseUrl, "/api/auth/device", {
        method: "POST",
        body: JSON.stringify({ deviceId }),
      });
    },

    async getBalance(token) {
      const data = await apiRequest<{ balance: number }>(baseUrl, "/api/credits/balance", { token });
      return data.balance;
    },

    getHistory(token, page = 1, limit = 20) {
      return apiRequest(baseUrl, `/api/credits/history?page=${page}&limit=${limit}`, { token });
    },

    async proxyStream(token, payload) {
      const res = await fetch(`${baseUrl}/api/proxy/openrouter/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      return res;
    },

    createRechargeOrder(token, amount) {
      return apiRequest(baseUrl, "/api/recharge/create", {
        method: "POST",
        token,
        body: JSON.stringify({ amount }),
      });
    },

    getQuota(token) {
      return apiRequest<QuotaInfo>(baseUrl, "/api/credits/quota", { token });
    },

    getSubscription(token) {
      return apiRequest<{ subscription: SubscriptionInfo | null }>(baseUrl, "/api/subscription", { token });
    },

    createSubscription(token, tier) {
      return apiRequest<{ status: string; message: string }>(baseUrl, "/api/subscription/create", {
        method: "POST",
        token,
        body: JSON.stringify({ tier }),
      });
    },

    register(email, password) {
      return apiRequest<{ token: string; userId: string }>(baseUrl, "/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
    },

    login(email, password) {
      return apiRequest<{ token: string; userId: string }>(baseUrl, "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
    },

    me(token) {
      return apiRequest<{ userId: string; email: string | null; plan: string }>(
        baseUrl,
        "/api/auth/me",
        { token }
      );
    },
  };
}

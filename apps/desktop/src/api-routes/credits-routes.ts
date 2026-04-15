import type { RouteHandler } from "./api-context.js";
import { sendJson, parseBody } from "./route-utils.js";
import {
  ACCESS_MODE_KEY,
  DEFAULT_ACCESS_MODE,
  type AccessMode,
} from "@rivonclaw/core";

export const handleCreditsRoutes: RouteHandler = async (req, res, url, pathname, ctx) => {
  const { storage, creditsClient, creditsToken, onProviderChange } = ctx;

  // GET /api/credits/balance
  if (pathname === "/api/credits/balance" && req.method === "GET") {
    const token = creditsToken?.();
    if (!token || !creditsClient) {
      sendJson(res, 200, { balance: null, mode: storage.settings.get(ACCESS_MODE_KEY) ?? DEFAULT_ACCESS_MODE });
      return true;
    }
    try {
      const balance = await creditsClient.getBalance(token);
      sendJson(res, 200, { balance, mode: storage.settings.get(ACCESS_MODE_KEY) ?? DEFAULT_ACCESS_MODE });
    } catch {
      sendJson(res, 200, { balance: null, mode: storage.settings.get(ACCESS_MODE_KEY) ?? DEFAULT_ACCESS_MODE });
    }
    return true;
  }

  // GET /api/credits/history
  if (pathname === "/api/credits/history" && req.method === "GET") {
    const token = creditsToken?.();
    if (!token || !creditsClient) {
      sendJson(res, 200, { entries: [], total: 0 });
      return true;
    }
    try {
      const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
      const limit = parseInt(url.searchParams.get("limit") ?? "20", 10) || 20;
      const data = await creditsClient.getHistory(token, page, limit);
      sendJson(res, 200, data);
    } catch {
      sendJson(res, 200, { entries: [], total: 0 });
    }
    return true;
  }

  // GET /api/credits/mode
  if (pathname === "/api/credits/mode" && req.method === "GET") {
    const mode = storage.settings.get(ACCESS_MODE_KEY) ?? DEFAULT_ACCESS_MODE;
    sendJson(res, 200, { mode });
    return true;
  }

  // POST /api/credits/mode
  if (pathname === "/api/credits/mode" && req.method === "POST") {
    const body = await parseBody(req) as { mode?: string };
    const validModes: AccessMode[] = ["credits", "coding-plan", "subscription"];
    if (!body.mode || !validModes.includes(body.mode as AccessMode)) {
      sendJson(res, 400, { error: "Invalid mode. Must be one of: credits, coding-plan, subscription" });
      return true;
    }
    storage.settings.set(ACCESS_MODE_KEY, body.mode);
    onProviderChange?.({ configOnly: true });
    sendJson(res, 200, { mode: body.mode });
    return true;
  }

  // GET /api/credits/quota
  if (pathname === "/api/credits/quota" && req.method === "GET") {
    const token = creditsToken?.();
    if (!token || !creditsClient) {
      sendJson(res, 200, {
        plan: "free",
        show_model: false,
        daily: { used: 0, limit: 100_000, resets_at: new Date(Date.now() + 86400000).toISOString() },
        monthly: null,
      });
      return true;
    }
    try {
      const quota = await creditsClient.getQuota(token);
      sendJson(res, 200, quota);
    } catch {
      sendJson(res, 200, {
        plan: "free",
        show_model: false,
        daily: { used: 0, limit: 100_000, resets_at: new Date(Date.now() + 86400000).toISOString() },
        monthly: null,
      });
    }
    return true;
  }

  // GET /api/subscription
  if (pathname === "/api/subscription" && req.method === "GET") {
    const token = creditsToken?.();
    if (!token || !creditsClient) {
      sendJson(res, 200, { subscription: null });
      return true;
    }
    try {
      const data = await creditsClient.getSubscription(token);
      sendJson(res, 200, data);
    } catch {
      sendJson(res, 200, { subscription: null });
    }
    return true;
  }

  // POST /api/subscription/create
  if (pathname === "/api/subscription/create" && req.method === "POST") {
    const token = creditsToken?.();
    const body = await parseBody(req) as { tier?: string };
    if (!token || !creditsClient) {
      sendJson(res, 200, { status: "unavailable", message: "积分服务未连接" });
      return true;
    }
    if (!body.tier || !["basic", "pro"].includes(body.tier)) {
      sendJson(res, 400, { error: "tier must be basic or pro" });
      return true;
    }
    try {
      const result = await creditsClient.createSubscription(token, body.tier as "basic" | "pro");
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // POST /api/recharge/create (stub)
  if (pathname === "/api/recharge/create" && req.method === "POST") {
    sendJson(res, 200, { orderId: null, status: "unavailable", message: "充值功能即将上线，敬请期待" });
    return true;
  }

  // POST /api/auth/register
  if (pathname === "/api/auth/register" && req.method === "POST") {
    const body = await parseBody(req) as { email?: string; password?: string };
    if (!creditsClient) {
      sendJson(res, 503, { error: "Credits service not configured" });
      return true;
    }
    try {
      const result = await creditsClient.register(body.email ?? "", body.password ?? "");
      sendJson(res, 200, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("already") ? 409 : 400;
      sendJson(res, status, { error: msg });
    }
    return true;
  }

  // POST /api/auth/login
  if (pathname === "/api/auth/login" && req.method === "POST") {
    const body = await parseBody(req) as { email?: string; password?: string };
    if (!creditsClient) {
      sendJson(res, 503, { error: "Credits service not configured" });
      return true;
    }
    try {
      const result = await creditsClient.login(body.email ?? "", body.password ?? "");
      sendJson(res, 200, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("Invalid") ? 401 : 400;
      sendJson(res, status, { error: msg });
    }
    return true;
  }

  // POST /api/auth/logout — server-side noop; panel clears its localStorage token
  if (pathname === "/api/auth/logout" && req.method === "POST") {
    sendJson(res, 200, { ok: true });
    return true;
  }

  // GET /api/auth/me
  if (pathname === "/api/auth/me" && req.method === "GET") {
    const authHeader = req.headers["authorization"] as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token || !creditsClient) {
      sendJson(res, 401, { error: "Unauthorized" });
      return true;
    }
    try {
      const data = await creditsClient.me(token);
      sendJson(res, 200, data);
    } catch {
      sendJson(res, 401, { error: "Unauthorized" });
    }
    return true;
  }

  return false;
};

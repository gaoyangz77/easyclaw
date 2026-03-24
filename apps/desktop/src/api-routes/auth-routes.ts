import { GQL } from "@rivonclaw/core";
import type { RouteHandler } from "./api-context.js";
import { parseBody, sendJson } from "./route-utils.js";

/** Decode the payload of a JWT without verification (already validated elsewhere). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64 = token.split(".")[1];
    if (!base64) return null;
    const json = Buffer.from(base64, "base64url").toString("utf-8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const handleAuthRoutes: RouteHandler = async (req, res, _url, pathname, ctx) => {
  if (!ctx.authSession) return false;

  // GET /api/auth/session — return current token + cached user
  if (pathname === "/api/auth/session" && req.method === "GET") {
    sendJson(res, 200, {
      accessToken: ctx.authSession.getAccessToken(),
      user: ctx.authSession.getCachedUser(),
    });
    return true;
  }

  // POST /api/auth/store-tokens — panel pushes tokens after login/register
  if (pathname === "/api/auth/store-tokens" && req.method === "POST") {
    const body = await parseBody(req) as { accessToken?: string; refreshToken?: string };
    if (!body.accessToken || !body.refreshToken) {
      sendJson(res, 400, { error: "Missing accessToken or refreshToken" });
      return true;
    }
    await ctx.authSession.storeTokens(body.accessToken, body.refreshToken);
    // Validate the session to cache user info
    let user = await ctx.authSession.validate();
    // Fallback: extract email from JWT payload when validate() fails (e.g. network error)
    if (!user) {
      const payload = decodeJwtPayload(body.accessToken);
      if (payload && typeof payload.email === "string") {
        user = { userId: (payload.sub as string) ?? "", email: payload.email, name: null, plan: ((payload.plan as string) ?? "") as GQL.UserPlan, enrolledModules: [], entitlementKeys: [], createdAt: new Date().toISOString() };
        ctx.authSession.setCachedUser(user);
      }
    }
    ctx.onAuthChange?.();
    sendJson(res, 200, { ok: true, user });
    return true;
  }

  // POST /api/auth/refresh — desktop refreshes and returns new access token
  if (pathname === "/api/auth/refresh" && req.method === "POST") {
    try {
      const accessToken = await ctx.authSession.refresh();
      sendJson(res, 200, { accessToken });
    } catch {
      sendJson(res, 401, { error: "Token refresh failed" });
    }
    return true;
  }

  // POST /api/auth/logout — clear tokens + best-effort cloud logout
  if (pathname === "/api/auth/logout" && req.method === "POST") {
    await ctx.authSession.logout();
    ctx.onAuthChange?.();
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
};

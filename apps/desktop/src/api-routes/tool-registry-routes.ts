import type { ToolScopeType, ToolSelection } from "@rivonclaw/core";
import { createLogger } from "@rivonclaw/logger";
import type { RouteHandler } from "./api-context.js";
import { parseBody, sendJson } from "./route-utils.js";
import { buildToolContext } from "../utils/tool-context-builder.js";

const log = createLogger("panel-server");

export const handleToolRegistryRoutes: RouteHandler = async (req, res, url, pathname, ctx) => {
  // GET /api/tools/available — available tools (empty for guests, entitled tools for authenticated users)
  if (pathname === "/api/tools/available" && req.method === "GET") {
    if (!ctx.authSession?.getAccessToken()) {
      sendJson(res, 200, { tools: [] });
      return true;
    }

    let tools = ctx.authSession.getCachedAvailableTools();
    if (!tools) {
      tools = await ctx.authSession.fetchAvailableTools();
    }
    sendJson(res, 200, { tools });
    return true;
  }

  // GET /api/tools/selections?scopeType=...&scopeKey=...
  if (pathname === "/api/tools/selections" && req.method === "GET") {
    const scopeType = url.searchParams.get("scopeType") as ToolScopeType | null;
    const scopeKey = url.searchParams.get("scopeKey");
    if (!scopeType || !scopeKey) {
      sendJson(res, 400, { error: "Missing scopeType or scopeKey" });
      return true;
    }

    const selections = ctx.storage.toolSelections.getForScope(scopeType, scopeKey);
    sendJson(res, 200, { selections });
    return true;
  }

  // PUT /api/tools/selections — save tool selections
  if (pathname === "/api/tools/selections" && req.method === "PUT") {
    const body = await parseBody(req) as {
      scopeType?: ToolScopeType;
      scopeKey?: string;
      selections?: ToolSelection[];
    };
    if (!body.scopeType || !body.scopeKey || !Array.isArray(body.selections)) {
      sendJson(res, 400, { error: "Missing scopeType, scopeKey, or selections" });
      return true;
    }

    ctx.storage.toolSelections.setForScope(body.scopeType, body.scopeKey, body.selections);

    // Push built tool context to gateway plugin for immediate availability
    const rpcClient = ctx.getRpcClient?.();
    if (ctx.authSession && rpcClient?.isConnected()) {
      buildToolContext(body.scopeType, body.scopeKey, ctx.storage, ctx.authSession)
        .then(toolContext => rpcClient.request("browser_profiles_set_run_context", toolContext))
        .catch((e: unknown) => log.warn("Failed to push tool context after PUT selections:", e));
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  // DEPRECATED: Ambiguous scope-agnostic lookup. Use GET /api/tools/selections with explicit scopeType instead.
  // Retained for backward compatibility. Do not use for plugin runtime enforcement.
  // GET /api/tools/selections-by-key?scopeKey=... — scope-agnostic lookup
  if (pathname === "/api/tools/selections-by-key" && req.method === "GET") {
    const scopeKey = url.searchParams.get("scopeKey");
    if (!scopeKey) {
      sendJson(res, 400, { error: "Missing scopeKey" });
      return true;
    }

    const result = ctx.storage.toolSelections.getByKey(scopeKey);
    sendJson(res, 200, result ?? { scopeType: null, selections: [] });
    return true;
  }

  // POST /api/tools/ensure-context — build and push effective context for a scope
  // Called by the panel when activating a session to ensure default preset is available
  if (pathname === "/api/tools/ensure-context" && req.method === "POST") {
    const body = await parseBody(req) as {
      scopeType?: string;
      scopeKey?: string;
    };
    if (!body.scopeType || !body.scopeKey) {
      sendJson(res, 400, { error: "Missing scopeType or scopeKey" });
      return true;
    }

    const validScopeTypes: string[] = ["chat_session", "cron_job", "app_run"];
    if (!validScopeTypes.includes(body.scopeType)) {
      sendJson(res, 400, { error: `Invalid scopeType: ${body.scopeType}` });
      return true;
    }

    if (!ctx.authSession?.getAccessToken()) {
      sendJson(res, 401, { error: "Not authenticated" });
      return true;
    }

    const toolContext = await buildToolContext(
      body.scopeType as ToolScopeType,
      body.scopeKey,
      ctx.storage,
      ctx.authSession,
    );

    const rpcClient = ctx.getRpcClient?.();
    if (rpcClient?.isConnected()) {
      await rpcClient.request("browser_profiles_set_run_context", toolContext);
    }

    sendJson(res, 200, toolContext);
    return true;
  }

  // DELETE /api/tools/selections?scopeType=...&scopeKey=...
  if (pathname === "/api/tools/selections" && req.method === "DELETE") {
    const scopeType = url.searchParams.get("scopeType") as ToolScopeType | null;
    const scopeKey = url.searchParams.get("scopeKey");
    if (!scopeType || !scopeKey) {
      sendJson(res, 400, { error: "Missing scopeType or scopeKey" });
      return true;
    }

    ctx.storage.toolSelections.deleteForScope(scopeType, scopeKey);

    // Rebuild effective context (server will apply default preset since selections are now gone)
    // and push to plugin so it reflects the new state, not stale old context.
    const rpcClient = ctx.getRpcClient?.();
    if (ctx.authSession && rpcClient?.isConnected()) {
      buildToolContext(scopeType as ToolScopeType, scopeKey, ctx.storage, ctx.authSession)
        .then(toolContext => rpcClient.request("browser_profiles_set_run_context", toolContext))
        .catch((e: unknown) => log.warn("Failed to push tool context after DELETE selections:", e));
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  // GET /api/tools/run-context?scopeType=...&scopeKey=...
  if (pathname === "/api/tools/run-context" && req.method === "GET") {
    const scopeType = url.searchParams.get("scopeType");
    const scopeKey = url.searchParams.get("scopeKey");
    if (!scopeType || !scopeKey) {
      sendJson(res, 400, { error: "scopeType and scopeKey are required" });
      return true;
    }

    const validScopeTypes: string[] = ["chat_session", "cron_job", "app_run"];
    if (!validScopeTypes.includes(scopeType)) {
      sendJson(res, 400, { error: `Invalid scopeType: ${scopeType}` });
      return true;
    }

    if (!ctx.authSession) {
      sendJson(res, 401, { error: "Not authenticated" });
      return true;
    }

    const toolContext = await buildToolContext(
      scopeType as ToolScopeType,
      scopeKey,
      ctx.storage,
      ctx.authSession,
    );
    sendJson(res, 200, toolContext);
    return true;
  }

  return false;
};

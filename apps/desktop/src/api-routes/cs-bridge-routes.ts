import type { RouteHandler } from "./api-context.js";
import { parseBody, sendJson } from "./route-utils.js";
import { getCsBridge } from "../gateway/gateway-connection.js";

/**
 * Routes for CS bridge management.
 *
 * Session-level operations (escalate, escalation-result, start-conversation,
 * get-escalation) get a session from the bridge and call session methods directly.
 */
export const handleCSBridgeRoutes: RouteHandler = async (req, res, _url, pathname, _ctx) => {

  // POST /api/cs-bridge/sync
  if ((pathname === "/api/cs-bridge/sync" || pathname === "/api/cs-bridge/refresh-shop") && req.method === "POST") {
    const bridge = getCsBridge();
    if (!bridge) {
      sendJson(res, 200, { ok: true, skipped: true });
      return true;
    }
    bridge.syncFromCache();
    sendJson(res, 200, { ok: true });
    return true;
  }

  // GET /api/cs-bridge/binding-status
  if (pathname === "/api/cs-bridge/binding-status" && req.method === "GET") {
    const bridge = getCsBridge();
    if (!bridge) {
      sendJson(res, 200, { connected: false, conflicts: [] });
      return true;
    }
    sendJson(res, 200, { connected: true, conflicts: bridge.getBindingConflicts() });
    return true;
  }

  // POST /api/cs-bridge/unbind
  if (pathname === "/api/cs-bridge/unbind" && req.method === "POST") {
    const body = await parseBody(req) as { shopId?: string };
    if (!body.shopId) { sendJson(res, 400, { error: "Missing shopId" }); return true; }
    getCsBridge()?.unbindShop(body.shopId);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // POST /api/cs-bridge/escalate — CS agent escalates to merchant channel
  if (pathname === "/api/cs-bridge/escalate" && req.method === "POST") {
    const bridge = getCsBridge();
    if (!bridge) { sendJson(res, 503, { error: "CS bridge not available" }); return true; }

    const body = await parseBody(req) as Record<string, unknown>;
    const missing = ["shopId", "conversationId", "buyerUserId", "reason"]
      .filter((f) => !body[f] || typeof body[f] !== "string");
    if (missing.length > 0) {
      sendJson(res, 400, { error: `Missing required fields: ${missing.join(", ")}` });
      return true;
    }

    try {
      const session = await bridge.getOrCreateSession(body.shopId as string, {
        conversationId: body.conversationId as string,
        buyerUserId: body.buyerUserId as string,
        orderId: typeof body.orderId === "string" ? body.orderId : undefined,
      });
      const result = await session.escalate({
        reason: body.reason as string,
        orderId: typeof body.orderId === "string" ? body.orderId : undefined,
        context: typeof body.context === "string" ? body.context : undefined,
      });
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // POST /api/cs-bridge/escalation-result — ops agent writes approval + wakes CS agent
  if (pathname === "/api/cs-bridge/escalation-result" && req.method === "POST") {
    const bridge = getCsBridge();
    if (!bridge) { sendJson(res, 503, { error: "CS bridge not available" }); return true; }

    const body = await parseBody(req) as Record<string, unknown>;
    const missing = ["escalationId", "decision", "instructions"]
      .filter((f) => !body[f] || typeof body[f] !== "string");
    if (missing.length > 0) {
      sendJson(res, 400, { error: `Missing required fields: ${missing.join(", ")}` });
      return true;
    }

    try {
      const escalationId = body.escalationId as string;

      // Look up escalation data (in-memory first, then storage fallback)
      const found = bridge.findEscalationById(escalationId);
      if (!found) {
        sendJson(res, 404, { error: `Escalation ${escalationId} not found` });
        return true;
      }

      // Get existing session or create one from stored context
      const session = bridge.findSessionByEscalationId(escalationId)
        ?? await bridge.getOrCreateSession(found.shopId, {
          conversationId: found.conversationId,
          buyerUserId: found.buyerUserId,
        });

      session.resolveEscalation(escalationId, {
        decision: body.decision as string,
        instructions: body.instructions as string,
        resolved: body.resolved === true,
      });

      const result = await session.dispatchEscalationResolved(escalationId);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // GET /api/cs-bridge/escalation/:id — CS agent reads escalation result
  if (pathname.startsWith("/api/cs-bridge/escalation/") && req.method === "GET") {
    const bridge = getCsBridge();
    if (!bridge) { sendJson(res, 503, { error: "CS bridge not available" }); return true; }

    const escalationId = decodeURIComponent(pathname.slice("/api/cs-bridge/escalation/".length));
    if (!escalationId) {
      sendJson(res, 400, { error: "Missing escalation ID" });
      return true;
    }

    const found = bridge.findEscalationById(escalationId);
    if (!found) {
      sendJson(res, 404, { error: `Escalation ${escalationId} not found` });
      return true;
    }

    const escalation = found.escalation;
    const status = escalation.result?.resolved ? "resolved" : escalation.result ? "in_progress" : "pending";
    sendJson(res, 200, {
      id: escalation.id,
      reason: escalation.reason,
      context: escalation.context ?? null,
      createdAt: escalation.createdAt,
      status,
      result: escalation.result ?? null,
      guidance: !escalation.result?.resolved
        ? "This escalation is still being processed. Continue to reassure the buyer and avoid making commitments. If the buyer is pressing, you may cs_escalate again to follow up with the manager."
        : null,
    });
    return true;
  }

  // POST /api/cs-bridge/start-conversation — manually start CS for a missed conversation
  if (pathname === "/api/cs-bridge/start-conversation" && req.method === "POST") {
    const bridge = getCsBridge();
    if (!bridge) { sendJson(res, 503, { error: "CS bridge not available" }); return true; }

    const body = await parseBody(req) as Record<string, unknown>;
    const missing = ["shopId", "conversationId", "buyerUserId"]
      .filter((f) => !body[f] || typeof body[f] !== "string");
    if (missing.length > 0) {
      sendJson(res, 400, { error: `Missing required fields: ${missing.join(", ")}` });
      return true;
    }

    try {
      const session = await bridge.getOrCreateSession(body.shopId as string, {
        conversationId: body.conversationId as string,
        buyerUserId: body.buyerUserId as string,
        orderId: typeof body.orderId === "string" ? body.orderId : undefined,
      });
      const result = await session.dispatchCatchUp();
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  return false;
};

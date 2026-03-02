import type { RouteHandler } from "./api-context.js";
import { sendJson, parseBody, extractIdFromPath } from "./route-utils.js";

/**
 * REST API for panel-local chat session metadata (archive, pin, custom title).
 *
 * GET    /api/chat-sessions              — list sessions (query: ?archived=true|false)
 * GET    /api/chat-sessions/:key         — get one session
 * PUT    /api/chat-sessions/:key         — upsert session attributes
 * DELETE /api/chat-sessions/:key         — remove session record
 */
export const handleChatSessionRoutes: RouteHandler = async (req, res, _url, pathname, ctx) => {
  const { storage } = ctx;

  // GET /api/chat-sessions
  if (pathname === "/api/chat-sessions" && req.method === "GET") {
    const url = new URL(req.url ?? "", "http://localhost");
    const archivedParam = url.searchParams.get("archived");
    const opts = archivedParam != null
      ? { archived: archivedParam === "true" }
      : undefined;
    const sessions = storage.chatSessions.list(opts);
    sendJson(res, 200, { sessions });
    return true;
  }

  // GET /api/chat-sessions/:key
  if (req.method === "GET") {
    const key = extractIdFromPath(pathname, "/api/chat-sessions/");
    if (!key) return false;
    const session = storage.chatSessions.getByKey(decodeURIComponent(key));
    if (!session) {
      sendJson(res, 404, { error: "Session not found" });
    } else {
      sendJson(res, 200, { session });
    }
    return true;
  }

  // PUT /api/chat-sessions/:key
  if (req.method === "PUT") {
    const key = extractIdFromPath(pathname, "/api/chat-sessions/");
    if (!key) return false;
    const body = (await parseBody(req)) as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    if ("customTitle" in body) fields.customTitle = body.customTitle as string | null;
    if ("pinned" in body) fields.pinned = Boolean(body.pinned);
    if ("archivedAt" in body) fields.archivedAt = body.archivedAt as number | null;
    const session = storage.chatSessions.upsert(decodeURIComponent(key), fields);
    sendJson(res, 200, { session });
    return true;
  }

  // DELETE /api/chat-sessions/:key
  if (req.method === "DELETE") {
    const key = extractIdFromPath(pathname, "/api/chat-sessions/");
    if (!key) return false;
    const decodedKey = decodeURIComponent(key);

    // Delete local metadata
    storage.chatSessions.delete(decodedKey);

    // Also delete from gateway (transcript + session entry)
    const rpcClient = ctx.getRpcClient?.();
    if (rpcClient?.isConnected()) {
      try {
        await rpcClient.request("sessions.delete", {
          key: decodedKey,
          deleteTranscript: true,
        });
      } catch {
        // Gateway deletion is best-effort; local metadata is already removed
      }
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
};

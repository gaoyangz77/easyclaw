import { API } from "@rivonclaw/core/api-contract";
import { openClawConnector } from "../openclaw/index.js";
import type { RouteRegistry, EndpointHandler } from "../infra/api/route-registry.js";
import type { ApiContext } from "../app/api-context.js";
import { sendJson, parseBody } from "../infra/api/route-utils.js";

const listChatSessions: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const { storage } = ctx;
  const url = new URL(req.url ?? "", "http://localhost");
  const archivedParam = url.searchParams.get("archived");
  const opts = archivedParam != null
    ? { archived: archivedParam === "true" }
    : undefined;
  const sessions = storage.chatSessions.list(opts);
  sendJson(res, 200, { sessions });
};

const getChatSession: EndpointHandler = async (_req, res, _url, params, ctx: ApiContext) => {
  const { storage } = ctx;
  const key = params.key;
  const session = storage.chatSessions.getByKey(key);
  if (!session) {
    sendJson(res, 404, { error: "Session not found" });
  } else {
    sendJson(res, 200, { session });
  }
};

const updateChatSession: EndpointHandler = async (req, res, _url, params, ctx: ApiContext) => {
  const { storage } = ctx;
  const key = params.key;
  const body = (await parseBody(req)) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  if ("customTitle" in body) fields.customTitle = body.customTitle as string | null;
  if ("panelTitle" in body) fields.panelTitle = body.panelTitle as string | null;
  if ("pinned" in body) fields.pinned = Boolean(body.pinned);
  if ("archivedAt" in body) fields.archivedAt = body.archivedAt as number | null;
  const session = storage.chatSessions.upsert(key, fields);
  sendJson(res, 200, { session });
};

const deleteChatSession: EndpointHandler = async (_req, res, _url, params, ctx: ApiContext) => {
  const { storage } = ctx;
  const key = params.key;

  // Delete local metadata
  storage.chatSessions.delete(key);

  // Also delete from gateway (transcript + session entry)
  try {
    await openClawConnector.request("sessions.delete", {
      key,
      deleteTranscript: true,
    });
  } catch {
    // Gateway deletion is best-effort; local metadata is already removed
  }

  sendJson(res, 200, { ok: true });
};

export function registerChatSessionsHandlers(registry: RouteRegistry): void {
  registry.register(API["chatSessions.list"], listChatSessions);
  registry.register(API["chatSessions.get"], getChatSession);
  registry.register(API["chatSessions.update"], updateChatSession);
  registry.register(API["chatSessions.delete"], deleteChatSession);
}

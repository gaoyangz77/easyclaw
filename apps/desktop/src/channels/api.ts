import { createLogger } from "@rivonclaw/logger";
import { DEFAULTS, formatError } from "@rivonclaw/core";
import { API } from "@rivonclaw/core/api-contract";
import { sendChannelMessage } from "./channel-senders.js";
import { openClawConnector } from "../openclaw/index.js";
import type { RouteRegistry, EndpointHandler } from "../infra/api/route-registry.js";
import type { ApiContext } from "../app/api-context.js";
import type { ChannelManagerInstance } from "./channel-manager.js";
import { sendJson, parseBody, proxiedFetch } from "../infra/api/route-utils.js";
import type { ServerResponse } from "node:http";

const log = createLogger("panel-server");

/** Extract channelManager or send 503 and return null. */
function requireChannelManager(ctx: ApiContext, res: ServerResponse): ChannelManagerInstance | null {
  if (!ctx.channelManager) {
    sendJson(res, 503, { error: "Channel manager not available" });
    return null;
  }
  return ctx.channelManager;
}

const APPROVAL_MESSAGES = {
  zh: "✅ [RivonClaw] 您的访问已获批准！现在可以开始和我对话了。",
  en: "✅ [RivonClaw] Your access has been approved! You can start chatting now.",
};

// ── GET /api/channels/status ──

const channelsStatus: EndpointHandler = async (req, res, url, _params, ctx: ApiContext) => {
  const cm = requireChannelManager(ctx, res);
  if (!cm) return;

  let rpcClient;
  try {
    rpcClient = openClawConnector.ensureRpcReady();
  } catch {
    sendJson(res, 503, { error: "Gateway not connected", snapshot: null });
    return;
  }

  try {
    const probe = url.searchParams.get("probe") === "true";
    const probeTimeoutMs = DEFAULTS.desktop.channelProbeTimeoutMs;
    const clientTimeoutMs = probe ? DEFAULTS.polling.channelProbeClientTimeoutMs : DEFAULTS.desktop.channelClientTimeoutMs;

    const snapshot = await cm.getChannelStatus(rpcClient, probe, probeTimeoutMs, clientTimeoutMs);
    sendJson(res, 200, { snapshot });
  } catch (err) {
    log.error("Failed to fetch channels status:", err);
    sendJson(res, 500, { error: String(err), snapshot: null });
  }
};

// ── GET /api/channels/accounts/:channelId/:accountId ──

const getAccount: EndpointHandler = async (_req, res, _url, params, ctx: ApiContext) => {
  const cm = requireChannelManager(ctx, res);
  if (!cm) return;
  const { channelId, accountId } = params;

  try {
    const account = cm.getAccount(channelId, accountId);
    if (!account) {
      sendJson(res, 404, { error: "Channel account not found" });
      return;
    }
    sendJson(res, 200, { channelId: account.channelId, accountId: account.accountId, name: account.name, config: account.config });
  } catch (err) {
    log.error("Failed to get channel account:", err);
    sendJson(res, 500, { error: String(err) });
  }
};

// ── POST /api/channels/accounts ──

const createAccount: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const cm = requireChannelManager(ctx, res);
  if (!cm) return;

  const body = (await parseBody(req)) as {
    channelId?: string;
    accountId?: string;
    name?: string;
    config?: Record<string, unknown>;
    secrets?: Record<string, string>;
  };

  if (!body.channelId || !body.accountId) {
    sendJson(res, 400, { error: "Missing required fields: channelId, accountId" });
    return;
  }

  if (!body.config || typeof body.config !== "object") {
    sendJson(res, 400, { error: "Missing required field: config" });
    return;
  }

  try {
    const accountConfig: Record<string, unknown> = {
      ...body.config,
      enabled: body.config.enabled ?? true,
    };

    if (body.name) {
      accountConfig.name = body.name;
    }

    cm.addAccount({
      channelId: body.channelId,
      accountId: body.accountId,
      name: body.name,
      config: accountConfig,
      secrets: body.secrets,
    });

    sendJson(res, 201, { ok: true, channelId: body.channelId, accountId: body.accountId });
    ctx.onChannelConfigured?.(body.channelId);
  } catch (err) {
    log.error("Failed to create channel account:", err);
    sendJson(res, 500, { error: String(err) });
  }
};

// ── PUT /api/channels/accounts/:channelId/:accountId ──

const updateAccount: EndpointHandler = async (req, res, _url, params, ctx: ApiContext) => {
  const cm = requireChannelManager(ctx, res);
  if (!cm) return;
  const { channelId, accountId } = params;

  const body = (await parseBody(req)) as {
    name?: string;
    config?: Record<string, unknown>;
    secrets?: Record<string, string>;
  };

  if (!body.config || typeof body.config !== "object") {
    sendJson(res, 400, { error: "Missing required field: config" });
    return;
  }

  try {
    cm.updateAccount({
      channelId,
      accountId,
      name: body.name,
      config: body.config,
      secrets: body.secrets,
    });

    sendJson(res, 200, { ok: true, channelId, accountId });
    ctx.onChannelConfigured?.(channelId);
  } catch (err) {
    log.error("Failed to update channel account:", err);
    sendJson(res, 500, { error: String(err) });
  }
};

// ── DELETE /api/channels/accounts/:channelId/:accountId ──

const deleteAccount: EndpointHandler = async (_req, res, _url, params, ctx: ApiContext) => {
  const cm = requireChannelManager(ctx, res);
  if (!cm) return;
  const { channelId, accountId } = params;

  try {
    cm.removeAccount(channelId, accountId);
    sendJson(res, 200, { ok: true, channelId, accountId });
  } catch (err) {
    log.error("Failed to delete channel account:", err);
    sendJson(res, 500, { error: String(err) });
  }
};

// ── POST /api/channels/qr-login/start ──

const qrLoginStart: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const cm = requireChannelManager(ctx, res);
  if (!cm) return;

  let rpcClient;
  try {
    rpcClient = openClawConnector.ensureRpcReady();
  } catch {
    sendJson(res, 503, { error: "Gateway not connected" });
    return;
  }

  const body = (await parseBody(req)) as { accountId?: string };

  try {
    const result = await cm.startQrLogin(rpcClient, body.accountId);
    sendJson(res, 200, result);
  } catch (err) {
    log.error("Failed to start QR login:", err);
    sendJson(res, 500, { error: formatError(err) });
  }
};

// ── POST /api/channels/qr-login/wait ──

const qrLoginWait: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const cm = requireChannelManager(ctx, res);
  if (!cm) return;

  let rpcClient;
  try {
    rpcClient = openClawConnector.ensureRpcReady();
  } catch {
    sendJson(res, 503, { error: "Gateway not connected" });
    return;
  }

  const body = (await parseBody(req)) as { accountId?: string; timeoutMs?: number };

  try {
    const result = await cm.waitQrLogin(rpcClient, body.accountId, body.timeoutMs);
    sendJson(res, 200, result);
  } catch (err) {
    log.error("Failed to wait for QR login:", err);
    sendJson(res, 500, { error: formatError(err) });
  }
};

// ── GET /api/pairing/requests/:channelId ──

const pairingRequests: EndpointHandler = async (_req, res, url, params, ctx: ApiContext) => {
  const cm = requireChannelManager(ctx, res);
  if (!cm) return;
  const { channelId } = params;
  const accountId = url.searchParams.get("accountId") || undefined;

  try {
    const requests = await cm.getPairingRequests(channelId, accountId);
    sendJson(res, 200, { requests });
  } catch (err) {
    log.error(`Failed to list pairing requests for ${channelId}:`, err);
    sendJson(res, 500, { error: String(err) });
  }
};

// ── GET /api/pairing/allowlist/:channelId ──

const getAllowlist: EndpointHandler = async (_req, res, url, params, ctx: ApiContext) => {
  const cm = requireChannelManager(ctx, res);
  if (!cm) return;
  const { channelId } = params;
  const accountId = url.searchParams.get("accountId") || undefined;

  try {
    const result = await cm.getAllowlist(channelId, accountId);
    sendJson(res, 200, result);
  } catch (err) {
    log.error(`Failed to read allowlist for ${channelId}:`, err);
    sendJson(res, 500, { error: String(err) });
  }
};

// ── PUT /api/pairing/allowlist/:channelId/:recipientId/label ──

const setLabel: EndpointHandler = async (req, res, url, params, ctx: ApiContext) => {
  const cm = requireChannelManager(ctx, res);
  if (!cm) return;
  const { channelId, recipientId } = params;
  const accountId = url.searchParams.get("accountId") || undefined;
  const body = (await parseBody(req)) as { label?: string };

  if (typeof body.label !== "string") {
    sendJson(res, 400, { error: "Missing required field: label" });
    return;
  }

  try {
    cm.setRecipientLabel(channelId, recipientId, body.label, accountId);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    log.error(`Failed to set recipient label:`, err);
    sendJson(res, 500, { error: String(err) });
  }
};

// ── PUT /api/pairing/allowlist/:channelId/:recipientId/owner ──

const setOwner: EndpointHandler = async (req, res, url, params, ctx: ApiContext) => {
  const cm = requireChannelManager(ctx, res);
  if (!cm) return;
  const { channelId, recipientId } = params;
  const accountId = url.searchParams.get("accountId") || undefined;
  const body = (await parseBody(req)) as { isOwner?: boolean };

  if (typeof body.isOwner !== "boolean") {
    sendJson(res, 400, { error: "Missing required field: isOwner (boolean)" });
    return;
  }

  try {
    cm.setRecipientOwner(channelId, recipientId, body.isOwner, accountId);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    log.error(`Failed to set recipient owner:`, err);
    sendJson(res, 500, { error: String(err) });
  }
};

// ── POST /api/pairing/approve ──

const approve: EndpointHandler = async (req, res, _url, _params, ctx: ApiContext) => {
  const cm = requireChannelManager(ctx, res);
  if (!cm) return;

  const body = (await parseBody(req)) as {
    channelId?: string;
    accountId?: string;
    code?: string;
    locale?: string;
  };

  if (!body.channelId || !body.code) {
    sendJson(res, 400, { error: "Missing required fields: channelId, code" });
    return;
  }

  try {
    const result = await cm.approvePairing({ channelId: body.channelId, accountId: body.accountId, code: body.code });

    sendJson(res, 200, { ok: true, id: result.recipientId, entry: result.entry });

    // Fire-and-forget confirmation message
    const locale = (body.locale === "zh" ? "zh" : "en") as "zh" | "en";
    const confirmMsg = APPROVAL_MESSAGES[locale];
    const boundFetch = (fetchUrl: string | URL, init?: RequestInit) => proxiedFetch(ctx.proxyRouterPort, fetchUrl, init);
    sendChannelMessage(body.channelId, result.recipientId, confirmMsg, boundFetch).then(ok => {
      if (ok) log.info(`Sent approval confirmation to ${body.channelId} user ${result.recipientId}`);
    });
  } catch (err: any) {
    if (err.message === "Pairing code not found or expired") {
      sendJson(res, 404, { error: err.message });
    } else {
      log.error("Failed to approve pairing:", err);
      sendJson(res, 500, { error: String(err) });
    }
  }
};

// ── DELETE /api/pairing/allowlist/:channelId/:recipientId ──

const removeFromAllowlist: EndpointHandler = async (_req, res, url, params, ctx: ApiContext) => {
  const cm = requireChannelManager(ctx, res);
  if (!cm) return;
  const { channelId, recipientId } = params;
  const accountId = url.searchParams.get("accountId") || undefined;

  try {
    const { changed } = await cm.removeFromAllowlist(channelId, recipientId, accountId);
    // Re-read the current allowlist for the response
    const { allowlist } = await cm.getAllowlist(channelId, accountId);
    sendJson(res, 200, { ok: true, changed, allowFrom: allowlist });
  } catch (err) {
    log.error("Failed to remove from allowlist:", err);
    sendJson(res, 500, { error: String(err) });
  }
};

// ── Registration ──

export function registerChannelsHandlers(registry: RouteRegistry): void {
  registry.register(API["channels.status"], channelsStatus);
  registry.register(API["channels.accounts.get"], getAccount);
  registry.register(API["channels.accounts.create"], createAccount);
  registry.register(API["channels.accounts.update"], updateAccount);
  registry.register(API["channels.accounts.delete"], deleteAccount);
  registry.register(API["channels.qrLogin.start"], qrLoginStart);
  registry.register(API["channels.qrLogin.wait"], qrLoginWait);
  registry.register(API["pairing.requests"], pairingRequests);
  registry.register(API["pairing.allowlist.get"], getAllowlist);
  registry.register(API["pairing.allowlist.setLabel"], setLabel);
  registry.register(API["pairing.allowlist.setOwner"], setOwner);
  registry.register(API["pairing.allowlist.remove"], removeFromAllowlist);
  registry.register(API["pairing.approve"], approve);
}

import { createLogger } from "@rivonclaw/logger";
import { DEFAULTS, formatError } from "@rivonclaw/core";
import { sendChannelMessage } from "../channels/channel-senders.js";
import { waitForGatewayReady } from "../gateway/rpc-client-ref.js";
import type { RouteHandler } from "./api-context.js";
import { sendJson, parseBody, proxiedFetch } from "./route-utils.js";

const log = createLogger("panel-server");

const APPROVAL_MESSAGES = {
  zh: "✅ [RivonClaw] 您的访问已获批准！现在可以开始和我对话了。",
  en: "✅ [RivonClaw] Your access has been approved! You can start chatting now.",
};

export const handleChannelRoutes: RouteHandler = async (req, res, url, pathname, ctx) => {
  const { storage, onChannelConfigured, channelManager } = ctx;

  // GET /api/channels/status
  if (pathname === "/api/channels/status" && req.method === "GET") {
    let rpcClient;
    try {
      rpcClient = await waitForGatewayReady(15_000);
    } catch {
      sendJson(res, 503, { error: "Gateway not connected", snapshot: null });
      return true;
    }

    try {
      const probe = url.searchParams.get("probe") === "true";
      const probeTimeoutMs = DEFAULTS.desktop.channelProbeTimeoutMs;
      const clientTimeoutMs = probe ? DEFAULTS.polling.channelProbeClientTimeoutMs : DEFAULTS.desktop.channelClientTimeoutMs;

      const snapshot = await channelManager!.getChannelStatus(rpcClient, probe, probeTimeoutMs, clientTimeoutMs);
      sendJson(res, 200, { snapshot });
    } catch (err) {
      log.error("Failed to fetch channels status:", err);
      sendJson(res, 500, { error: String(err), snapshot: null });
    }
    return true;
  }

  // GET /api/channels/accounts/:channelId/:accountId — read config from SQLite
  if (pathname.startsWith("/api/channels/accounts/") && req.method === "GET") {
    const parts = pathname.slice("/api/channels/accounts/".length).split("/");
    if (parts.length !== 2) {
      sendJson(res, 400, { error: "Invalid path format. Expected: /api/channels/accounts/:channelId/:accountId" });
      return true;
    }

    const [channelId, accountId] = parts.map(decodeURIComponent);

    try {
      const account = storage.channelAccounts.get(channelId, accountId);
      if (!account) {
        sendJson(res, 404, { error: "Channel account not found" });
        return true;
      }
      sendJson(res, 200, { channelId: account.channelId, accountId: account.accountId, name: account.name, config: account.config });
    } catch (err) {
      log.error("Failed to get channel account:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // POST /api/channels/accounts
  if (pathname === "/api/channels/accounts" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      channelId?: string;
      accountId?: string;
      name?: string;
      config?: Record<string, unknown>;
      secrets?: Record<string, string>;
    };

    if (!body.channelId || !body.accountId) {
      sendJson(res, 400, { error: "Missing required fields: channelId, accountId" });
      return true;
    }

    if (!body.config || typeof body.config !== "object") {
      sendJson(res, 400, { error: "Missing required field: config" });
      return true;
    }

    try {
      const accountConfig: Record<string, unknown> = {
        ...body.config,
        enabled: body.config.enabled ?? true,
      };

      if (body.name) {
        accountConfig.name = body.name;
      }

      channelManager!.addAccount({
        channelId: body.channelId,
        accountId: body.accountId,
        name: body.name,
        config: accountConfig,
        secrets: body.secrets,
      });

      sendJson(res, 201, { ok: true, channelId: body.channelId, accountId: body.accountId });
      onChannelConfigured?.(body.channelId);
    } catch (err) {
      log.error("Failed to create channel account:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // PUT /api/channels/accounts/:channelId/:accountId
  if (pathname.startsWith("/api/channels/accounts/") && req.method === "PUT") {
    const parts = pathname.slice("/api/channels/accounts/".length).split("/");
    if (parts.length !== 2) {
      sendJson(res, 400, { error: "Invalid path format. Expected: /api/channels/accounts/:channelId/:accountId" });
      return true;
    }

    const [channelId, accountId] = parts.map(decodeURIComponent);
    const body = (await parseBody(req)) as {
      name?: string;
      config?: Record<string, unknown>;
      secrets?: Record<string, string>;
    };

    if (!body.config || typeof body.config !== "object") {
      sendJson(res, 400, { error: "Missing required field: config" });
      return true;
    }

    try {
      channelManager!.updateAccount({
        channelId,
        accountId,
        name: body.name,
        config: body.config,
        secrets: body.secrets,
      });

      sendJson(res, 200, { ok: true, channelId, accountId });
      onChannelConfigured?.(channelId);
    } catch (err) {
      log.error("Failed to update channel account:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // DELETE /api/channels/accounts/:channelId/:accountId
  if (pathname.startsWith("/api/channels/accounts/") && req.method === "DELETE") {
    const parts = pathname.slice("/api/channels/accounts/".length).split("/");
    if (parts.length !== 2) {
      sendJson(res, 400, { error: "Invalid path format. Expected: /api/channels/accounts/:channelId/:accountId" });
      return true;
    }

    const [channelId, accountId] = parts.map(decodeURIComponent);

    try {
      channelManager!.removeAccount(channelId, accountId);
      sendJson(res, 200, { ok: true, channelId, accountId });
    } catch (err) {
      log.error("Failed to delete channel account:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // GET /api/pairing/requests/:channelId
  if (pathname.startsWith("/api/pairing/requests/") && req.method === "GET") {
    const channelId = decodeURIComponent(pathname.slice("/api/pairing/requests/".length));
    if (!channelId) {
      sendJson(res, 400, { error: "Channel ID is required" });
      return true;
    }

    try {
      const requests = await channelManager!.getPairingRequests(channelId);
      sendJson(res, 200, { requests });
    } catch (err) {
      log.error(`Failed to list pairing requests for ${channelId}:`, err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // GET /api/pairing/allowlist/:channelId
  if (pathname.startsWith("/api/pairing/allowlist/") && req.method === "GET") {
    const channelId = decodeURIComponent(pathname.slice("/api/pairing/allowlist/".length).split("/")[0]);
    if (!channelId) {
      sendJson(res, 400, { error: "Channel ID is required" });
      return true;
    }
    const accountId = url.searchParams.get("accountId") || undefined;

    try {
      const result = await channelManager!.getAllowlist(channelId, accountId);
      sendJson(res, 200, result);
    } catch (err) {
      log.error(`Failed to read allowlist for ${channelId}:`, err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // PUT /api/pairing/allowlist/:channelId/:entry/label
  if (pathname.match(/^\/api\/pairing\/allowlist\/[^/]+\/[^/]+\/label$/) && req.method === "PUT") {
    const segments = pathname.slice("/api/pairing/allowlist/".length).split("/");
    const channelId = decodeURIComponent(segments[0]);
    const recipientId = decodeURIComponent(segments[1]);
    const body = (await parseBody(req)) as { label?: string };

    if (typeof body.label !== "string") {
      sendJson(res, 400, { error: "Missing required field: label" });
      return true;
    }

    try {
      channelManager!.setRecipientLabel(channelId, recipientId, body.label);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      log.error(`Failed to set recipient label:`, err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // PUT /api/pairing/allowlist/:channelId/:entry/owner
  if (pathname.match(/^\/api\/pairing\/allowlist\/[^/]+\/[^/]+\/owner$/) && req.method === "PUT") {
    const segments = pathname.slice("/api/pairing/allowlist/".length).split("/");
    const channelId = decodeURIComponent(segments[0]);
    const recipientId = decodeURIComponent(segments[1]);
    const body = (await parseBody(req)) as { isOwner?: boolean };

    if (typeof body.isOwner !== "boolean") {
      sendJson(res, 400, { error: "Missing required field: isOwner (boolean)" });
      return true;
    }

    try {
      channelManager!.setRecipientOwner(channelId, recipientId, body.isOwner);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      log.error(`Failed to set recipient owner:`, err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // POST /api/pairing/approve
  if (pathname === "/api/pairing/approve" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      channelId?: string;
      code?: string;
      locale?: string;
    };

    if (!body.channelId || !body.code) {
      sendJson(res, 400, { error: "Missing required fields: channelId, code" });
      return true;
    }

    try {
      const result = await channelManager!.approvePairing({ channelId: body.channelId, code: body.code });

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
    return true;
  }

  // DELETE /api/pairing/allowlist/:channelId/:entry
  if (pathname.startsWith("/api/pairing/allowlist/") && req.method === "DELETE") {
    const parts = pathname.slice("/api/pairing/allowlist/".length).split("/");
    if (parts.length !== 2) {
      sendJson(res, 400, { error: "Invalid path format. Expected: /api/pairing/allowlist/:channelId/:entry" });
      return true;
    }

    const [channelId, entry] = parts.map(decodeURIComponent);

    try {
      const { changed } = await channelManager!.removeFromAllowlist(channelId, entry);
      // Re-read the current allowlist for the response
      const { allowlist } = await channelManager!.getAllowlist(channelId);
      sendJson(res, 200, { ok: true, changed, allowFrom: allowlist });
    } catch (err) {
      log.error("Failed to remove from allowlist:", err);
      sendJson(res, 500, { error: String(err) });
    }
    return true;
  }

  // POST /api/channels/qr-login/start
  if (pathname === "/api/channels/qr-login/start" && req.method === "POST") {
    let rpcClient;
    try {
      rpcClient = await waitForGatewayReady(15_000);
    } catch {
      sendJson(res, 503, { error: "Gateway not connected" });
      return true;
    }

    const body = (await parseBody(req)) as { accountId?: string };

    try {
      const result = await channelManager!.startQrLogin(rpcClient, body.accountId);
      sendJson(res, 200, result);
    } catch (err) {
      log.error("Failed to start QR login:", err);
      sendJson(res, 500, { error: formatError(err) });
    }
    return true;
  }

  // POST /api/channels/qr-login/wait
  if (pathname === "/api/channels/qr-login/wait" && req.method === "POST") {
    let rpcClient;
    try {
      rpcClient = await waitForGatewayReady(15_000);
    } catch {
      sendJson(res, 503, { error: "Gateway not connected" });
      return true;
    }

    const body = (await parseBody(req)) as { accountId?: string; timeoutMs?: number };

    try {
      const result = await channelManager!.waitQrLogin(rpcClient, body.accountId, body.timeoutMs);
      sendJson(res, 200, result);
    } catch (err) {
      log.error("Failed to wait for QR login:", err);
      sendJson(res, 500, { error: formatError(err) });
    }
    return true;
  }

  return false;
};

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RouteHandler } from "./api-context.js";
import { parseBody, sendJson } from "./route-utils.js";
import { deleteMaterialized } from "../browser-profiles/materializer.js";

/** Find the default Chrome executable path for the current platform. */
function findDefaultChromePath(): string | null {
  if (process.platform === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
    return candidates.find(p => existsSync(p)) ?? null;
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? "";
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const candidates = [
      join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    ];
    return candidates.find(p => existsSync(p)) ?? null;
  }
  // Linux
  const candidates = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
  return candidates.find(p => existsSync(p)) ?? null;
}

export const handleBrowserProfilesRoutes: RouteHandler = async (req, res, _url, pathname, ctx) => {
  // GET /api/browser-profiles/managed — list managed browser entries
  if (pathname === "/api/browser-profiles/managed" && req.method === "GET") {
    const entries = ctx.managedBrowserService?.getAllEntries() ?? [];
    sendJson(res, 200, { entries });
    return true;
  }

  // POST /api/browser-profiles/:id/managed/launch — launch a managed browser
  const launchMatch = pathname.match(/^\/api\/browser-profiles\/([^/]+)\/managed\/launch$/);
  if (launchMatch && req.method === "POST") {
    const profileId = launchMatch[1];
    if (!ctx.managedBrowserService) {
      sendJson(res, 503, { error: "Managed browser service not available" });
      return true;
    }

    const body = await parseBody(req) as { chromePath?: string };
    const chromePath = body.chromePath || findDefaultChromePath();

    if (!chromePath) {
      sendJson(res, 400, { error: "Chrome path not found" });
      return true;
    }

    try {
      const port = await ctx.managedBrowserService.launchBrowser(profileId, chromePath);
      sendJson(res, 200, { ok: true, port });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : "Failed to launch browser" });
    }
    return true;
  }

  // POST /api/browser-profiles/:id/managed/connect — connect to externally-launched browser
  const connectMatch = pathname.match(/^\/api\/browser-profiles\/([^/]+)\/managed\/connect$/);
  if (connectMatch && req.method === "POST") {
    const profileId = connectMatch[1];
    if (!ctx.managedBrowserService) {
      sendJson(res, 503, { error: "Managed browser service not available" });
      return true;
    }

    const body = await parseBody(req) as { port: number };
    if (!body.port || typeof body.port !== "number") {
      sendJson(res, 400, { error: "Missing or invalid port" });
      return true;
    }

    try {
      const connected = await ctx.managedBrowserService.connectBrowser(profileId, body.port);
      sendJson(res, 200, { ok: connected, port: body.port });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : "Failed to connect" });
    }
    return true;
  }

  // POST /api/browser-profiles/:id/managed/stop — stop tracking a managed browser
  const stopMatch = pathname.match(/^\/api\/browser-profiles\/([^/]+)\/managed\/stop$/);
  if (stopMatch && req.method === "POST") {
    const profileId = stopMatch[1];
    if (!ctx.managedBrowserService) {
      sendJson(res, 503, { error: "Managed browser service not available" });
      return true;
    }

    try {
      await ctx.managedBrowserService.stopTracking(profileId);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : "Failed to stop tracking" });
    }
    return true;
  }

  // POST /api/browser-profiles/test-proxy — test proxy connectivity locally
  if (pathname === "/api/browser-profiles/test-proxy" && req.method === "POST") {
    const body = await parseBody(req) as { id?: string };
    if (!body.id) {
      sendJson(res, 400, { error: "Missing id" });
      return true;
    }

    // Fetch profile from cloud to get proxy config
    if (!ctx.authSession?.getAccessToken()) {
      sendJson(res, 401, { error: "Not authenticated" });
      return true;
    }

    try {
      const data = await ctx.authSession.graphqlFetch<{
        browserProfile: { id: string; proxyPolicy?: { enabled: boolean; baseUrl?: string } } | null;
      }>(
        `query ($id: ID!) { browserProfile(id: $id) { id proxyPolicy { enabled baseUrl } } }`,
        { id: body.id },
      );

      const profile = data.browserProfile;
      if (!profile) {
        sendJson(res, 404, { error: "Profile not found" });
        return true;
      }

      if (!profile.proxyPolicy?.enabled || !profile.proxyPolicy?.baseUrl) {
        sendJson(res, 200, { ok: false, message: "No proxy configured", checkedAt: new Date().toISOString() });
        return true;
      }

      // Test proxy connectivity
      const proxyUrl = profile.proxyPolicy.baseUrl;
      try {
        const testRes = await fetch(proxyUrl, { method: "HEAD", signal: AbortSignal.timeout(5000) });
        sendJson(res, 200, { ok: testRes.ok, message: `Proxy responded with ${testRes.status}`, checkedAt: new Date().toISOString() });
      } catch (proxyErr) {
        sendJson(res, 200, { ok: false, message: proxyErr instanceof Error ? proxyErr.message : "Proxy unreachable", checkedAt: new Date().toISOString() });
      }
    } catch (err) {
      sendJson(res, 502, { error: err instanceof Error ? err.message : "Failed to fetch profile" });
    }
    return true;
  }

  // GET /api/browser-profiles/sessions — list active session profile IDs with targets
  if (pathname === "/api/browser-profiles/sessions" && req.method === "GET") {
    const mgr = ctx.sessionLifecycleManager;
    const activeProfiles = mgr?.getActiveProfileIds() ?? [];
    const sessions = activeProfiles.map(id => ({
      profileId: id,
      target: mgr?.getSessionTarget(id) ?? null,
    }));
    sendJson(res, 200, { activeProfiles, sessions });
    return true;
  }

  // POST /api/browser-profiles/:id/session/start — start session state tracking
  const startMatch = pathname.match(/^\/api\/browser-profiles\/([^/]+)\/session\/start$/);
  if (startMatch && req.method === "POST") {
    const profileId = startMatch[1];
    if (!ctx.sessionLifecycleManager) {
      sendJson(res, 503, { error: "Session lifecycle manager not available" });
      return true;
    }

    const body = await parseBody(req) as { target?: string; cdpPort?: number };

    // Determine runtime target (default to managed_profile — the primary path).
    const target = (body.target === "cdp" || body.target === "managed_profile")
      ? body.target
      : "managed_profile";

    // Resolve CDP port for targets that need it
    const cdpPort = body.cdpPort
      ?? (target === "cdp" ? parseInt(ctx.storage.settings.get("browser-cdp-port") || "", 10) : undefined);

    try {
      const { createAdapter } = await import("../browser-profiles/adapter-factory.js");
      const adapter = createAdapter(target, {
        profileId,
        cdpPort: Number.isFinite(cdpPort) ? cdpPort : undefined,
      });
      await ctx.sessionLifecycleManager.startSession(profileId, adapter, target);
      sendJson(res, 200, { ok: true, target });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : "Failed to start session" });
    }
    return true;
  }

  // POST /api/browser-profiles/:id/session/end — end session state tracking
  const endMatch = pathname.match(/^\/api\/browser-profiles\/([^/]+)\/session\/end$/);
  if (endMatch && req.method === "POST") {
    const profileId = endMatch[1];
    if (!ctx.sessionLifecycleManager) {
      sendJson(res, 503, { error: "Session lifecycle manager not available" });
      return true;
    }

    try {
      await ctx.sessionLifecycleManager.endSession(profileId);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : "Failed to end session" });
    }
    return true;
  }

  // GET/PUT /api/browser-profiles/:id/session-policy — proxy to cloud sessionStatePolicy
  const policyMatch = pathname.match(/^\/api\/browser-profiles\/([^/]+)\/session-policy$/);
  if (policyMatch) {
    const profileId = decodeURIComponent(policyMatch[1]);
    const defaultPolicy = { enabled: true, checkpointIntervalSec: 120, mode: "cookies_only", storage: "local" };

    if (req.method === "GET") {
      if (!ctx.authSession?.getAccessToken()) {
        sendJson(res, 200, defaultPolicy);
        return true;
      }
      try {
        const data = await ctx.authSession.graphqlFetch<{
          browserProfile: { id: string; sessionStatePolicy: { enabled: boolean; checkpointIntervalSec: number; mode: string; storage: string } } | null;
        }>(
          `query ($id: ID!) { browserProfile(id: $id) { id sessionStatePolicy { enabled checkpointIntervalSec mode storage } } }`,
          { id: profileId },
        );
        sendJson(res, 200, data.browserProfile?.sessionStatePolicy ?? defaultPolicy);
      } catch {
        sendJson(res, 200, defaultPolicy);
      }
      return true;
    }

    if (req.method === "PUT") {
      if (!ctx.authSession?.getAccessToken()) {
        sendJson(res, 401, { error: "Not authenticated" });
        return true;
      }

      const body = await parseBody(req) as {
        enabled?: boolean;
        checkpointIntervalSec?: number;
        mode?: string;
        storage?: string;
      };

      try {
        const data = await ctx.authSession.graphqlFetch<{
          updateBrowserProfile: { id: string; sessionStatePolicy: { enabled: boolean; checkpointIntervalSec: number; mode: string; storage: string } };
        }>(
          `mutation ($id: ID!, $input: UpdateBrowserProfileInput!) { updateBrowserProfile(id: $id, input: $input) { id sessionStatePolicy { enabled checkpointIntervalSec mode storage } } }`,
          { id: profileId, input: { sessionStatePolicy: body } },
        );
        sendJson(res, 200, { ok: true, sessionStatePolicy: data.updateBrowserProfile.sessionStatePolicy });
      } catch (err) {
        sendJson(res, 502, { error: err instanceof Error ? err.message : "Failed to update session policy" });
      }
      return true;
    }
  }

  // DELETE /api/browser-profiles/:id/data — clean up local Chrome profile directory
  const deleteMatch = pathname.match(/^\/api\/browser-profiles\/([^/]+)\/data$/);
  if (deleteMatch && req.method === "DELETE") {
    const profileId = deleteMatch[1];

    // End any active session before deleting profile data
    if (ctx.sessionLifecycleManager?.hasActiveSession(profileId)) {
      await ctx.sessionLifecycleManager.endSession(profileId);
    }

    const basePath = process.env.RIVONCLAW_DATA_DIR ?? "/tmp/rivonclaw";
    try {
      await deleteMaterialized(profileId, basePath);

      // Best-effort cloud backup cleanup
      if (ctx.authSession?.getAccessToken()) {
        ctx.authSession.graphqlFetch(
          `mutation ($profileId: ID!) { deleteSessionStateBackup(profileId: $profileId) }`,
          { profileId },
        ).catch(() => {}); // best-effort
      }

      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 200, { ok: false, message: err instanceof Error ? err.message : "Failed to delete data" });
    }
    return true;
  }

  return false;
};

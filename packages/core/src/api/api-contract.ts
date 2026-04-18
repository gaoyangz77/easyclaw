import { DEFAULTS } from "../defaults.js";

/**
 * Shared API contract — single source of truth for all Desktop↔Panel endpoints.
 *
 * Both Desktop (route-registry) and Panel (fetchJson/EventSource) import from here.
 * Adding, renaming, or removing an endpoint requires changing this file only;
 * TypeScript will surface all call sites that need updating.
 *
 * Path format: full server path including `/api` prefix.
 * Parametric segments use `:param` syntax (e.g. `/api/rules/:id`).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RouteEntry {
  readonly method: HttpMethod;
  readonly path: string;
  readonly desc?: string;
}

export interface SSERouteEntry {
  readonly method: "GET";
  readonly path: string;
  readonly sse: true;
  readonly desc?: string;
}

export interface PrefixRouteEntry {
  readonly method: "*";
  readonly pathPrefix: string;
  readonly desc?: string;
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export const API = {
  // ── Auth ──
  "auth.session":            { method: "GET",    path: "/api/auth/session",               desc: "Get current user and auth state" },
  "auth.login":              { method: "POST",   path: "/api/auth/login",                 desc: "Login with email/password" },
  "auth.register":           { method: "POST",   path: "/api/auth/register",              desc: "Register new account" },
  "auth.requestCaptcha":     { method: "POST",   path: "/api/auth/request-captcha",       desc: "Request captcha challenge" },
  "auth.storeTokens":        { method: "POST",   path: "/api/auth/store-tokens",          desc: "Store auth tokens from Panel" },
  "auth.refresh":            { method: "POST",   path: "/api/auth/refresh",               desc: "Refresh access token" },
  "auth.logout":             { method: "POST",   path: "/api/auth/logout",                desc: "Logout and clear tokens" },

  // ── App / Status ──
  "app.status":              { method: "GET",    path: "/api/status",                     desc: "App status (rule count, device ID)" },
  "app.apiBaseUrl":          { method: "GET",    path: "/api/app/api-base-url",           desc: "Cloud API base URL" },
  "app.update":              { method: "GET",    path: "/api/app/update",                 desc: "Check for available updates" },
  "app.gatewayInfo":         { method: "GET",    path: "/api/app/gateway-info",           desc: "Gateway WebSocket URL and token" },
  "app.changelog":           { method: "GET",    path: "/api/app/changelog",              desc: "Get changelog entries" },
  "app.updateDownload":      { method: "POST",   path: "/api/app/update/download",        desc: "Start downloading update" },
  "app.updateCancel":        { method: "POST",   path: "/api/app/update/cancel",          desc: "Cancel update download" },
  "app.updateDownloadStatus":{ method: "GET",    path: "/api/app/update/download-status", desc: "Get download progress" },
  "app.updateInstall":       { method: "POST",   path: "/api/app/update/install",         desc: "Install downloaded update" },

  // ── Settings ──
  "settings.getAll":         { method: "GET",    path: "/api/settings",                   desc: "Get all app settings" },
  "settings.update":         { method: "PUT",    path: "/api/settings",                   desc: "Update multiple settings" },
  "settings.validateKey":    { method: "POST",   path: "/api/settings/validate-key",      desc: "Validate provider API key" },
  "settings.validateCustomKey": { method: "POST", path: "/api/settings/validate-custom-key", desc: "Validate custom provider key" },
  "settings.telemetry.get":  { method: "GET",    path: "/api/settings/telemetry",         desc: "Get telemetry enabled state" },
  "settings.telemetry.set":  { method: "PUT",    path: "/api/settings/telemetry",         desc: "Set telemetry enabled" },
  "settings.autoLaunch.get": { method: "GET",    path: "/api/settings/auto-launch",       desc: "Get auto-launch enabled state" },
  "settings.autoLaunch.set": { method: "PUT",    path: "/api/settings/auto-launch",       desc: "Set auto-launch enabled" },
  "settings.openclawStateDir.get":    { method: "GET",    path: "/api/settings/openclaw-state-dir",  desc: "Get OpenClaw state dir override" },
  "settings.openclawStateDir.set":    { method: "PUT",    path: "/api/settings/openclaw-state-dir",  desc: "Set OpenClaw state dir override" },
  "settings.openclawStateDir.delete": { method: "DELETE", path: "/api/settings/openclaw-state-dir",  desc: "Clear state dir override" },

  // ── Agent Settings ──
  "agentSettings.get":       { method: "GET",    path: "/api/agent-settings",             desc: "Get agent session config (dmScope)" },
  "agentSettings.set":       { method: "PUT",    path: "/api/agent-settings",             desc: "Update agent session config" },

  // ── Telemetry ──
  "telemetry.track":         { method: "POST",   path: "/api/telemetry/track",            desc: "Track analytics event" },
  "telemetry.cs.track":      { method: "POST",   path: "/api/telemetry/cs-track",         desc: "Track CS business event (bypasses user opt-in)" },

  // ── Permissions ──
  "permissions.get":         { method: "GET",    path: "/api/permissions",                desc: "Get file access permissions" },
  "permissions.update":      { method: "PUT",    path: "/api/permissions",                desc: "Update file permissions" },

  // ── Workspace ──
  "workspace.get":           { method: "GET",    path: "/api/workspace",                  desc: "Get workspace directory path" },
  "fileDialog.open":         { method: "POST",   path: "/api/file-dialog",                desc: "Open native file picker" },

  // ── Rules ──
  "rules.list":              { method: "GET",    path: "/api/rules",                      desc: "List all rules with artifact status" },
  "rules.create":            { method: "POST",   path: "/api/rules",                      desc: "Create a new rule" },
  "rules.update":            { method: "PUT",    path: "/api/rules/:id",                  desc: "Update rule text" },
  "rules.delete":            { method: "DELETE", path: "/api/rules/:id",                  desc: "Delete rule and artifacts" },

  // ── Provider Keys ──
  "providerKeys.list":       { method: "GET",    path: "/api/provider-keys",              desc: "List all provider API keys" },
  "providerKeys.create":     { method: "POST",   path: "/api/provider-keys",              desc: "Create new provider key" },
  "providerKeys.update":     { method: "PUT",    path: "/api/provider-keys/:id",          desc: "Update provider key config" },
  "providerKeys.delete":     { method: "DELETE", path: "/api/provider-keys/:id",          desc: "Delete provider key" },
  "providerKeys.activate":   { method: "POST",   path: "/api/provider-keys/:id/activate", desc: "Set as global default key" },
  "providerKeys.refreshModels": { method: "POST", path: "/api/provider-keys/:id/refresh-models", desc: "Refresh models for custom provider" },
  "providerKeys.fetchUsage": { method: "POST", path: "/api/provider-keys/:id/usage/fetch", desc: "Fetch subscription quota usage for a key (writes into MST)" },
  "providerKeys.reauth":     { method: "POST", path: "/api/provider-keys/:id/reauth",        desc: "Re-authenticate OAuth and rotate stored credentials in place" },

  // ── Session Model ──
  "sessionModel.get":        { method: "GET",    path: "/api/session-model",              desc: "Get per-session model override" },
  "sessionModel.set":        { method: "PUT",    path: "/api/session-model",              desc: "Set per-session model override" },

  // ── Models / Catalog ──
  "models.catalog":          { method: "GET",    path: "/api/models",                     desc: "Full model catalog from all providers" },
  "models.fetchCustom":      { method: "POST",   path: "/api/custom-provider/fetch-models", desc: "Fetch models from custom OpenAI-compatible provider" },

  // ── Local Models ──
  "localModels.detect":      { method: "GET",    path: "/api/local-models/detect",        desc: "Auto-detect local model servers (Ollama)" },
  "localModels.models":      { method: "GET",    path: "/api/local-models/models",        desc: "Fetch models from local server" },
  "localModels.health":      { method: "POST",   path: "/api/local-models/health",        desc: "Check local model server health" },

  // ── OAuth ──
  "oauth.start":             { method: "POST",   path: "/api/oauth/start",                desc: "Start OAuth flow for provider" },
  "oauth.save":              { method: "POST",   path: "/api/oauth/save",                 desc: "Save OAuth-acquired credentials" },
  "oauth.manualComplete":    { method: "POST",   path: "/api/oauth/manual-complete",      desc: "Complete manual OAuth via callback URL" },
  "oauth.status":            { method: "GET",    path: "/api/oauth/status",               desc: "Poll OAuth flow status" },

  // ── Channels ──
  "channels.status":         { method: "GET",    path: "/api/channels/status",            desc: "Get channel connection status" },
  "channels.accounts.get":   { method: "GET",    path: "/api/channels/accounts/:channelId/:accountId", desc: "Get channel account config" },
  "channels.accounts.create":{ method: "POST",   path: "/api/channels/accounts",          desc: "Create channel account" },
  "channels.accounts.update":{ method: "PUT",    path: "/api/channels/accounts/:channelId/:accountId", desc: "Update channel account" },
  "channels.accounts.delete":{ method: "DELETE", path: "/api/channels/accounts/:channelId/:accountId", desc: "Delete channel account" },
  "channels.qrLogin.start":  { method: "POST",   path: "/api/channels/qr-login/start",   desc: "Start QR code login" },
  "channels.qrLogin.wait":   { method: "POST",   path: "/api/channels/qr-login/wait",    desc: "Wait for QR login completion" },

  // ── Pairing ──
  "pairing.requests":        { method: "GET",    path: "/api/pairing/requests/:channelId", desc: "List pairing requests for channel" },
  "pairing.allowlist.get":   { method: "GET",    path: "/api/pairing/allowlist/:channelId", desc: "Get allowlist for channel" },
  "pairing.allowlist.setLabel":  { method: "PUT",    path: "/api/pairing/allowlist/:channelId/:recipientId/label", desc: "Set recipient display label" },
  "pairing.allowlist.setOwner":  { method: "PUT",    path: "/api/pairing/allowlist/:channelId/:recipientId/owner", desc: "Set recipient owner flag" },
  "pairing.allowlist.remove":    { method: "DELETE", path: "/api/pairing/allowlist/:channelId/:recipientId",       desc: "Remove from allowlist" },
  "pairing.approve":         { method: "POST",   path: "/api/pairing/approve",            desc: "Approve pairing request" },

  // ── Chat Sessions ──
  "chatSessions.list":       { method: "GET",    path: "/api/chat-sessions",              desc: "List chat sessions" },
  "chatSessions.get":        { method: "GET",    path: "/api/chat-sessions/:key",         desc: "Get session metadata" },
  "chatSessions.update":     { method: "PUT",    path: "/api/chat-sessions/:key",         desc: "Update session (title, pin, archive)" },
  "chatSessions.delete":     { method: "DELETE", path: "/api/chat-sessions/:key",         desc: "Delete session" },

  // ── Usage ──
  "usage.summary":           { method: "GET",    path: "/api/usage",                      desc: "Overall usage summary" },
  "usage.keyUsage":          { method: "GET",    path: "/api/key-usage",                  desc: "Per-key/model usage" },
  "usage.activeKey":         { method: "GET",    path: "/api/key-usage/active",           desc: "Active key info" },
  "usage.timeseries":        { method: "GET",    path: "/api/key-usage/timeseries",       desc: "Daily usage time series" },

  // ── Skills ──
  "skills.bundledSlugs":     { method: "GET",    path: "/api/skills/bundled-slugs",       desc: "List bundled skill slugs" },
  "skills.installed":        { method: "GET",    path: "/api/skills/installed",           desc: "List installed skills" },
  "skills.install":          { method: "POST",   path: "/api/skills/install",             desc: "Install skill from registry" },
  "skills.writeTemplate":    { method: "POST",   path: "/api/skills/write-template",      desc: "Write SKILL.md template" },
  "skills.delete":           { method: "POST",   path: "/api/skills/delete",              desc: "Delete installed skill" },
  "skills.openFolder":       { method: "POST",   path: "/api/skills/open-folder",         desc: "Open skills folder in file explorer" },

  // ── Tool Registry ──
  "tools.effectiveTools":    { method: "GET",    path: "/api/tools/effective-tools",      desc: "Get effective tools for scope" },
  "tools.runProfile.get":    { method: "GET",    path: "/api/tools/run-profile",          desc: "Get RunProfile for session" },
  "tools.runProfile.set":    { method: "PUT",    path: "/api/tools/run-profile",          desc: "Set RunProfile for session" },

  // ── STT ──
  "stt.credentials.get":     { method: "GET",    path: "/api/stt/credentials",            desc: "Check STT provider credentials" },
  "stt.credentials.set":     { method: "PUT",    path: "/api/stt/credentials",            desc: "Save STT credentials" },
  "stt.transcribe":          { method: "POST",   path: "/api/stt/transcribe",             desc: "Transcribe audio to text" },
  "stt.status":              { method: "GET",    path: "/api/stt/status",                 desc: "Get STT enabled status" },

  // ── Extras (Web Search / Embedding) ──
  "extras.credentials.get":  { method: "GET",    path: "/api/extras/credentials",         desc: "Check web search/embedding credentials" },
  "extras.credentials.set":  { method: "PUT",    path: "/api/extras/credentials",         desc: "Save web search/embedding credentials" },

  // ── Mobile Chat ──
  "mobile.graphql":          { method: "POST",   path: "/api/graphql/mobile",             desc: "Mobile GraphQL endpoint" },
  "mobile.pairingCode":      { method: "POST",   path: "/api/mobile/pairing-code/generate", desc: "Generate mobile pairing code" },
  "mobile.installUrl":       { method: "GET",    path: "/api/mobile/install-url",         desc: "Get PWA install URL" },
  "mobile.status":           { method: "GET",    path: "/api/mobile/status",              desc: "Get pairing status and pairings" },
  "mobile.deviceStatus":     { method: "GET",    path: "/api/mobile/device-status",       desc: "Get device presence status" },
  "mobile.disconnect":       { method: "DELETE", path: "/api/mobile/disconnect",          desc: "Disconnect mobile pairing" },

  // ── Browser Profiles ──
  "browserProfiles.managed":        { method: "GET",    path: "/api/browser-profiles/managed",            desc: "List managed browser entries" },
  "browserProfiles.launch":         { method: "POST",   path: "/api/browser-profiles/:id/managed/launch", desc: "Launch managed browser" },
  "browserProfiles.connect":        { method: "POST",   path: "/api/browser-profiles/:id/managed/connect", desc: "Connect to external browser" },
  "browserProfiles.stop":           { method: "POST",   path: "/api/browser-profiles/:id/managed/stop",   desc: "Stop tracking managed browser" },
  "browserProfiles.testProxy":      { method: "POST",   path: "/api/browser-profiles/test-proxy",         desc: "Test proxy connectivity" },
  "browserProfiles.sessions":       { method: "GET",    path: "/api/browser-profiles/sessions",           desc: "List active session profiles" },
  "browserProfiles.sessionStart":   { method: "POST",   path: "/api/browser-profiles/:id/session/start",  desc: "Start session state tracking" },
  "browserProfiles.sessionEnd":     { method: "POST",   path: "/api/browser-profiles/:id/session/end",    desc: "End session state tracking" },
  "browserProfiles.sessionPolicy.get": { method: "GET",  path: "/api/browser-profiles/:id/session-policy", desc: "Get session state policy" },
  "browserProfiles.sessionPolicy.set": { method: "PUT",  path: "/api/browser-profiles/:id/session-policy", desc: "Update session state policy" },
  "browserProfiles.deleteData":     { method: "DELETE", path: "/api/browser-profiles/:id/data",            desc: "Clean up local Chrome profile" },

  // ── CS Bridge ──
  "csBridge.sync":           { method: "POST",   path: "/api/cs-bridge/sync",             desc: "Sync CS bridge from entity cache" },
  "csBridge.refreshShop":    { method: "POST",   path: "/api/cs-bridge/refresh-shop",     desc: "Refresh shop context" },
  "csBridge.bindingStatus":  { method: "GET",    path: "/api/cs-bridge/binding-status",   desc: "Get bridge connection and binding status" },
  "csBridge.unbind":         { method: "POST",   path: "/api/cs-bridge/unbind",           desc: "Unbind shop from this device" },
  "csBridge.escalate":       { method: "POST",   path: "/api/cs-bridge/escalate",         desc: "Escalate CS conversation to merchant" },
  "csBridge.escalationResult": { method: "POST", path: "/api/cs-bridge/escalation-result", desc: "Write escalation approval/denial" },
  "csBridge.escalation.get": { method: "GET",    path: "/api/cs-bridge/escalation/:id",   desc: "Read escalation result" },
  "csBridge.startConversation": { method: "POST", path: "/api/cs-bridge/start-conversation", desc: "Manually start CS for a conversation" },

  // ── Dependencies ──
  "deps.provision":          { method: "POST",   path: "/api/deps/provision",             desc: "Trigger dependency provisioner" },

  // ── Logs ──
  "logs.upload":             { method: "POST",   path: "/api/logs/upload",                desc: "Upload rivonclaw.log to cloud backend" },

  // ── Cloud Proxy ──
  "cloud.graphql":           { method: "POST",   path: DEFAULTS.api.cloudGraphql,          desc: "Cloud GraphQL proxy (JWT injected)" },
  // cloud.rest is a prefix-based wildcard — see PrefixRouteEntry
} as const satisfies Record<string, RouteEntry>;

/** Cloud REST proxy — matches any method, any path under this prefix. */
export const CLOUD_REST_PREFIX: PrefixRouteEntry = {
  method: "*",
  pathPrefix: DEFAULTS.api.cloudRestPrefix,
  desc: "Cloud REST proxy (strips /cloud, forwards with JWT)",
} as const;

/** SSE (Server-Sent Events) stream endpoints. */
export const SSE = {
  "chat.events":     { method: "GET", path: "/api/chat/events",   sse: true, desc: "Real-time chat and pairing events" },
  "store.stream":    { method: "GET", path: "/api/store/stream",  sse: true, desc: "MST entity store patch sync" },
  "status.stream":   { method: "GET", path: "/api/status/stream", sse: true, desc: "Runtime status patch sync" },
  "doctor.run":      { method: "GET", path: "/api/doctor/run",    sse: true, desc: "Run OpenClaw doctor diagnostics" },
} as const satisfies Record<string, SSERouteEntry>;

/** Static media serving prefix. */
export const MEDIA_PREFIX = "/api/media/";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Build a full server path by replacing `:param` segments with encoded values.
 *
 * @example buildPath(API["rules.delete"], { id: "abc" }) → "/api/rules/abc"
 */
export function buildPath(
  route: { readonly path: string },
  params?: Record<string, string>,
): string {
  let result: string = route.path;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(`:${key}`, encodeURIComponent(value));
    }
  }
  return result;
}

/**
 * Build a client-relative path (strips the `/api` prefix) for use with
 * Panel's `fetchJson` which prepends `/api` automatically.
 *
 * @example clientPath(API["rules.delete"], { id: "abc" }) → "/rules/abc"
 */
export function clientPath(
  route: { readonly path: string },
  params?: Record<string, string>,
): string {
  const full = buildPath(route, params);
  return full.startsWith("/api") ? full.slice(4) : full;
}

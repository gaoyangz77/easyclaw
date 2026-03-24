/**
 * Centralized default configuration values.
 *
 * Fork maintainers: edit this file to customize defaults for your deployment.
 * All values are re-exported by their original modules for backward compatibility.
 */
export const DEFAULTS = {
  ports: {
    gateway: 28789,
    panel: 3210,
    proxyRouter: 9999,
    panelDev: 5180,
    cdpOffset: 12,
  },

  relay: {
    maxClientBytes: 14 * 1024 * 1024, // 14 MB
  },

  gateway: {
    initialBackoffMs: 1_000,
    maxBackoffMs: 30_000,
    healthyThresholdMs: 60_000,
    startupGraceMs: 15_000,
  },

  rules: {
    maxPolicyLength: 4_000,
    maxRetries: 3,
    retryBaseDelayMs: 1_000,
  },

  logger: {
    maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
  },

  stt: {
    defaultProvider: "groq" as "groq",
    defaultEnabled: false,
  },

  browserProfiles: {
    defaultSessionStateMode: "cookies_only" as "cookies_only",
    defaultSessionStateStorage: "local" as "local",
    defaultCheckpointIntervalSec: 60,
  },

  mobileSync: {
    sentHistoryLimit: 200,
    outboxLimit: 500,
    ackTimeoutMs: 30_000,
    saveDebounceMs: 500,
    processedIdsLimit: 1_000,
  },

  desktop: {
    updateMarkerMaxAgeMs: 5 * 60 * 1_000,
    shutdownTimeoutMs: 10_000,
    heartbeatIntervalMs: 10_000,
    heartbeatStaleMs: 30_000,
    oauthCleanupIntervalMs: 5 * 60 * 1_000,
    probeTimeoutMs: 2_000,
    fetchTimeoutMs: 5_000,
    doctorTimeoutMs: 60_000,
    pairingCodeTtlMs: 60_000,
    usageCacheTtlMs: 30_000,
    channelProbeTimeoutMs: 8_000,
    channelClientTimeoutMs: 10_000,
    agentReplyTimeoutMs: 60_000,
  },

  depsProvisioner: {
    execTimeoutMs: 5_000,
    installTimeoutMs: 5 * 60_000,
  },

  currency: {
    cnyUsd: 7.0,
  },

  gatewayConfig: {
    sessionResetMode: "idle" as "idle",
    sessionResetIdleMinutes: 43200, // 30 days
    toolsProfile: "full" as "full",
    execHost: "gateway" as "gateway",
    execSecurity: "full" as "full",
    defaultBrowserCdpPort: 9222,
    audioMaxBytes: 25 * 1024 * 1024, // 25 MB
    audioTimeoutSeconds: 300, // 5 min
  },

  permissions: {
    filePermissionsFullAccess: true,
  },

  settings: {
    browserMode: "standalone" as "standalone",
    sessionStateCdpEnabled: true,
    collapseMessages: true,
    showAgentEvents: false,
    preserveToolEvents: false,
    tutorialEnabled: true,
    showAgentName: true,
  },

  chat: {
    compressMaxDimension: 1280,
    compressTargetBytes: 300 * 1024, // 300 KB
    compressInitialQuality: 0.85,
    compressMinQuality: 0.4,
    initialVisibleMessages: 50,
    fetchBatch: 200,
    sessionRefreshDebounceMs: 2_000,
    maxCachedSessions: 20,
    maxImageAttachmentBytes: 5 * 1_000 * 1_000, // 5 MB
  },

  cron: {
    defaultIntervalValue: 60,
    defaultIntervalUnit: "minutes" as "minutes",
  },

  pagination: {
    skills: 12,
    cronHistory: 20,
    browserProfiles: 20,
    browserProfilesOptions: [20, 50, 100] as number[],
  },

  polling: {
    usageRefreshMs: 60_000,
    rulesCompilationPollMs: 3_000,
    channelProbeClientTimeoutMs: 25_000,
  },

  // ---------------------------------------------------------------------------
  // Domains & URLs — single source of truth for all external endpoints.
  // Fork maintainers: change these to point at your own infrastructure.
  // ---------------------------------------------------------------------------

  /** First-party service domains (no protocol — composed by endpoints.ts). */
  domains: {
    api: "api.rivonclaw.com",
    apiCn: "api.zhuazhuaai.cn",
    web: "www.rivonclaw.com",
    webCn: "www.zhuazhuaai.cn",
    staging: "stg.rivonclaw.com",
    telemetry: "t.rivonclaw.com",
    telemetryCn: "t.zhuazhuaai.cn",
  },

  /** Third-party channel API hosts. */
  channels: {
    telegram: "api.telegram.org",
    feishu: "open.feishu.cn",
    lark: "open.larksuite.com",
    line: "api.line.me",
    wecom: "qyapi.weixin.qq.com",
  },

  /** Third-party provider API hosts. */
  providers: {
    anthropic: "api.anthropic.com",
  },

  /** Local model server defaults. */
  ollama: {
    host: "localhost",
    port: 11434,
  },

  /** External installer / setup script URLs. */
  installers: {
    homebrew: "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh",
    uvUnix: "https://astral.sh/uv/install.sh",
    uvWindows: "https://astral.sh/uv/install.ps1",
    winget: "https://aka.ms/getwinget",
  },

  /** URL used to detect whether Google is reachable (GFW probe). */
  gfwProbeUrl: "https://www.google.com/generate_204",
};

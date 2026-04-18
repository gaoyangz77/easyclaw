import type { Storage } from "@rivonclaw/storage";
import type { SecretStore } from "@rivonclaw/secrets";
import type { UsageSnapshotEngine } from "../usage/usage-snapshot-engine.js";
import type { UsageQueryService } from "../usage/usage-query-service.js";
import type { MobileManagerInstance } from "../mobile/mobile-manager.js";
import type { AuthSessionManager } from "../auth/session.js";
import type { SessionLifecycleManager } from "../browser-profiles/session-lifecycle-manager.js";
import type { ManagedBrowserService } from "../browser-profiles/managed-browser-service.js";
import type { CloudClient } from "../cloud/cloud-client.js";
import type { ChannelManagerInstance } from "../channels/channel-manager.js";

export interface ApiContext {
  storage: Storage;
  secretStore: SecretStore;
  proxyRouterPort: number;
  gatewayPort: number;
  onRuleChange?: (action: "created" | "updated" | "deleted" | "channel-created" | "channel-deleted", ruleId: string) => void;
  onProviderChange?: (hint?: { configOnly?: boolean; keyOnly?: boolean }) => void;
  onOpenFileDialog?: () => Promise<string | null>;
  sttManager?: {
    transcribe(audio: Buffer, format: string): Promise<string | null>;
    isEnabled(): boolean;
    getProvider(): string | null;
  };
  onSttChange?: () => void;
  onExtrasChange?: () => void;
  onPermissionsChange?: () => void;
  onAuthChange?: () => void;
  onToolSelectionChange?: (effectiveToolIds: string[]) => void;
  onBrowserChange?: () => void;
  onAutoLaunchChange?: (enabled: boolean) => void;
  onChannelConfigured?: (channelId: string) => void;
  onOAuthFlow?: (provider: string) => Promise<{ providerKeyId: string; email?: string; provider: string }>;
  onOAuthAcquire?: (provider: string) => Promise<{ email?: string; tokenPreview: string; manualMode?: boolean; authUrl?: string; flowId?: string }>;
  onOAuthSave?: (provider: string, options: { proxyUrl?: string; label?: string; model?: string }) => Promise<{ providerKeyId: string; email?: string; provider: string }>;
  /**
   * Re-authenticate an existing OAuth provider key: consume the most recently
   * completed OAuth flow for the key's provider, overwrite the stored credential
   * in place (no new row, no change to label/model/isDefault/proxy), refresh the
   * derived token expiry, and sync auth-profiles so the gateway picks up the new
   * token on the next LLM turn. No gateway restart — keys hot-reload from auth-profiles.
   */
  /**
   * `idTokenCaptureFailed` is `true` when the post-OAuth token-endpoint call
   * (used to capture id_token → subscription expiry) failed. Panel uses this
   * to warn the user about a narrow OAuth server-side rotation race.
   */
  onOAuthReauth?: (keyId: string) => Promise<{ ok: true; idTokenCaptureFailed: boolean }>;
  onOAuthManualComplete?: (provider: string, callbackUrl: string) => Promise<{ email?: string; tokenPreview: string }>;
  onOAuthPoll?: (flowId: string) => { status: "pending" | "completed" | "failed"; tokenPreview?: string; email?: string; error?: string };
  onTelemetryTrack?: (eventType: string, metadata?: Record<string, unknown>) => void;
  /**
   * Emit a Customer Service business-telemetry event. Routed through a
   * separate always-on `RemoteTelemetryClient` that ships to the CS BI
   * ClickHouse stream — bypasses the `telemetry_enabled` user opt-in.
   * No-op if the CS telemetry client is not initialized (dev without
   * `DEV_TELEMETRY=1`, init failure).
   */
  onCsTelemetryTrack?: (eventType: string, metadata?: Record<string, unknown>) => void;
  vendorDir: string;
  /** Node.js binary path — Electron's process.execPath with ELECTRON_RUN_AS_NODE=1 */
  nodeBin: string;
  deviceId?: string;
  getUpdateResult?: () => {
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion?: string;
    downloadUrl?: string | null;
  } | null;
  getGatewayInfo?: () => { wsUrl: string; token?: string };
  snapshotEngine?: UsageSnapshotEngine;
  queryService?: UsageQueryService;
  mobileManager?: MobileManagerInstance;
  authSession?: AuthSessionManager;
  cloudClient?: CloudClient;
  sessionLifecycleManager?: SessionLifecycleManager;
  managedBrowserService?: ManagedBrowserService;
  channelManager?: ChannelManagerInstance;
}

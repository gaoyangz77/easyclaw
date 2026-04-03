import type { IncomingMessage, ServerResponse } from "node:http";
import type { Storage } from "@rivonclaw/storage";
import type { SecretStore } from "@rivonclaw/secrets";
import type { UsageSnapshotEngine } from "../usage/usage-snapshot-engine.js";
import type { UsageQueryService } from "../usage/usage-query-service.js";
import type { MobileManagerInstance } from "../store/mobile-manager.js";
import type { AuthSessionManager } from "../auth/auth-session.js";
import type { SessionLifecycleManager } from "../browser-profiles/session-lifecycle-manager.js";
import type { ManagedBrowserService } from "../browser-profiles/managed-browser-service.js";
import type { CloudClient } from "../clients/cloud-client.js";
import type { ChannelManagerInstance } from "../store/channel-manager.js";

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
  onOAuthManualComplete?: (provider: string, callbackUrl: string) => Promise<{ email?: string; tokenPreview: string }>;
  onOAuthPoll?: (flowId: string) => { status: "pending" | "completed" | "failed"; tokenPreview?: string; email?: string; error?: string };
  onTelemetryTrack?: (eventType: string, metadata?: Record<string, unknown>) => void;
  vendorDir: string;
  /** Node.js binary path — Electron's process.execPath with ELECTRON_RUN_AS_NODE=1 */
  nodeBin: string;
  deviceId?: string;
  getUpdateResult?: () => {
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion?: string;
    download?: { url: string; sha256: string; size: number };
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

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  pathname: string,
  ctx: ApiContext,
) => Promise<boolean>;

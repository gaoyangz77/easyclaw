import type { IncomingMessage, ServerResponse } from "node:http";
import type { Storage } from "@easyclaw/storage";
import type { SecretStore } from "@easyclaw/secrets";
import type { GatewayRpcClient } from "@easyclaw/gateway";
import type { UsageSnapshotEngine } from "../usage-snapshot-engine.js";
import type { UsageQueryService } from "../usage-query-service.js";
import type { createWeComRelay } from "../wecom-relay.js";

export interface ApiContext {
  storage: Storage;
  secretStore: SecretStore;
  getRpcClient?: () => GatewayRpcClient | null;
  onRuleChange?: (action: "created" | "updated" | "deleted" | "channel-created" | "channel-deleted", ruleId: string) => void;
  onProviderChange?: (hint?: { configOnly?: boolean; keyOnly?: boolean }) => void;
  onOpenFileDialog?: () => Promise<string | null>;
  sttManager?: {
    transcribe(audio: Buffer, format: string): Promise<string | null>;
    isEnabled(): boolean;
    getProvider(): string | null;
  };
  onSttChange?: () => void;
  onPermissionsChange?: () => void;
  onBrowserChange?: () => void;
  onAutoLaunchChange?: (enabled: boolean) => void;
  onChannelConfigured?: (channelId: string) => void;
  onOAuthFlow?: (provider: string) => Promise<{ providerKeyId: string; email?: string; provider: string }>;
  onOAuthAcquire?: (provider: string) => Promise<{ email?: string; tokenPreview: string; manualMode?: boolean; authUrl?: string }>;
  onOAuthSave?: (provider: string, options: { proxyUrl?: string; label?: string; model?: string }) => Promise<{ providerKeyId: string; email?: string; provider: string }>;
  onOAuthManualComplete?: (provider: string, callbackUrl: string) => Promise<{ email?: string; tokenPreview: string }>;
  onTelemetryTrack?: (eventType: string, metadata?: Record<string, unknown>) => void;
  vendorDir?: string;
  deviceId?: string;
  getUpdateResult?: () => {
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion?: string;
    download?: { url: string; sha256: string; size: number };
    releaseNotes?: string;
  } | null;
  getGatewayInfo?: () => { wsUrl: string; token?: string };
  snapshotEngine?: UsageSnapshotEngine;
  queryService?: UsageQueryService;
  wecomRelay?: ReturnType<typeof createWeComRelay>;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  pathname: string,
  ctx: ApiContext,
) => Promise<boolean>;

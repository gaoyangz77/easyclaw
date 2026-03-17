export type BrowserProfileId = string;

export type BrowserProfileStatus = "active" | "disabled" | "archived";

export interface BrowserProfileProxyPolicy {
  proxyBaseUrl?: string | null;
  proxyEnabled: boolean;
  pacUrl?: string | null;
  bypassDomains?: string[];
}

export interface BrowserProfileVisibility {
  scope: "local" | "workspace" | "team" | "cloud";
  tags?: string[];
  allowAgentRead: boolean;
  allowAgentWrite: boolean;
}

export interface BrowserProfileEntitlement {
  enabled: boolean;
  canEdit: boolean;
  canAgentWrite: boolean;
  source: "local" | "cloud";
}

export interface BrowserProfileSummary {
  id: BrowserProfileId;
  remoteProfileId?: string | null;
  name: string;
  materializedPath?: string | null;
  proxyPolicy: BrowserProfileProxyPolicy;
  tags: string[];
  status: BrowserProfileStatus;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number | null;
}

export interface BrowserProfileDetail extends BrowserProfileSummary {
  notes?: string | null;
  visibility?: BrowserProfileVisibility;
  entitlement?: BrowserProfileEntitlement;
  sessionStatePolicy?: BrowserProfileSessionStatePolicy;
}

export interface BrowserProfileResolveResult {
  profile: BrowserProfileDetail;
  launchArgs?: string[];
  cdpUrl?: string | null;
  safetyFlags?: string[];
  resolvedAt: number;
}

export type BrowserProfilesDisclosureLevel = "off" | "minimal" | "standard" | "full";

export interface BrowserProfilesCapabilityBinding {
  enabled: boolean;
  disclosureLevel: BrowserProfilesDisclosureLevel;
  allowDynamicDiscovery: boolean;
  visibleTags?: string[];
  namePrefixes?: string[];
}

export interface AgentRunCapabilityContext {
  browserProfiles?: BrowserProfilesCapabilityBinding;
  entitlementSnapshot?: Record<string, boolean>;
}

export interface BrowserProfilesFilterInput {
  query?: string;
  tags?: string[];
  namePrefixes?: string[];
  status?: BrowserProfileStatus[];
}

export interface CreateBrowserProfileInput {
  id: BrowserProfileId;
  remoteProfileId?: string | null;
  name: string;
  materializedPath?: string | null;
  proxyBaseUrl?: string | null;
  proxyEnabled?: boolean;
  tags?: string[];
  notes?: string | null;
  status?: BrowserProfileStatus;
  sessionStatePolicy?: BrowserProfileSessionStatePolicy;
}

export interface UpdateBrowserProfileInput {
  remoteProfileId?: string | null;
  name?: string;
  materializedPath?: string | null;
  proxyBaseUrl?: string | null;
  proxyEnabled?: boolean;
  tags?: string[];
  notes?: string | null;
  status?: BrowserProfileStatus;
  lastUsedAt?: number | null;
  sessionStatePolicy?: BrowserProfileSessionStatePolicy;
}

export interface BrowserProfileProxyTestResult {
  ok: boolean;
  message: string;
  checkedAt: number;
}

export type BrowserProfilesToolAction =
  | "list"
  | "get"
  | "find"
  | "resolve_for_task"
  | "update"
  | "test_proxy";

export interface BrowserProfilesToolRequest {
  action: BrowserProfilesToolAction;
  profileId?: BrowserProfileId;
  filter?: BrowserProfilesFilterInput;
  update?: UpdateBrowserProfileInput;
  taskDescription?: string;
}

export interface BrowserProfilesToolResponse {
  ok: boolean;
  profiles?: BrowserProfileSummary[];
  profile?: BrowserProfileDetail;
  resolveResult?: BrowserProfileResolveResult;
  proxyTest?: BrowserProfileProxyTestResult;
  message?: string;
}

/**
 * Runtime target for session-state persistence.
 *
 * Session-state persistence is a shared foundation. The runtime target
 * identifies which browser runtime a session operates against:
 *
 * - `managed_profile` — PRIMARY target: RivonClaw-managed multi-profile browser.
 *   Each profile gets its own Chrome instance with a dedicated CDP port.
 * - `cdp` — COMPATIBILITY target: User's existing Chrome via CDP debug port.
 *   Single browser, single session (profile key: "__cdp__").
 */
export type SessionStateRuntimeTarget = "managed_profile" | "cdp";

// --- Phase 28: Session State Persistence (Batch 1 — Contracts) ---

/** Controls what session data is persisted for a browser profile. */
export type BrowserProfileSessionStateMode = "off" | "cookies_only" | "cookies_and_storage";

/**
 * Where session state snapshots are authoritatively stored.
 * - "local": local disk is the sole authority; no cloud interaction
 * - "cloud": cloud-authoritative; local is a performance cache.
 *   Restore compares cloud and local manifests by updatedAt to use
 *   the fresher snapshot, ensuring cross-device consistency.
 */
export type BrowserProfileSessionStateStorage = "local" | "cloud";

/**
 * Profile-level policy controlling session state persistence behavior.
 * Each profile carries its own policy — there is no global toggle.
 */
export interface BrowserProfileSessionStatePolicy {
  mode: BrowserProfileSessionStateMode;
  storage: BrowserProfileSessionStateStorage;
  checkpointIntervalSec: number;
}

/**
 * Metadata for a persisted session state snapshot on disk.
 * Stored as manifest.json inside the profile's session-state directory.
 */
export interface BrowserProfileSessionSnapshotMeta {
  profileId: BrowserProfileId;
  updatedAt: number;
  /** Content hash (SHA-256) of the snapshot payload. */
  hash: string;
  cookieCount: number;
  /** Present when mode includes storage. */
  storageKeys?: string[];
}

/**
 * Runtime summary of a profile's session state (for UI/diagnostics).
 * Not persisted — computed on demand by the runtime service.
 */
export interface BrowserProfileRuntimeStateSummary {
  profileId: BrowserProfileId;
  hasSnapshot: boolean;
  snapshotMeta?: BrowserProfileSessionSnapshotMeta;
  policy: BrowserProfileSessionStatePolicy;
  lastRestoreAt?: number;
  lastCheckpointAt?: number;
}

/**
 * Default session state policy applied when a profile does not specify one.
 * - cookies_only: persist cookies but not localStorage/sessionStorage
 * - local: snapshots stored on disk, no cloud upload
 * - checkpointIntervalSec: 60s periodic checkpoint
 *
 * Note: restore-on-launch is implicit when mode != "off" — no separate flag needed.
 */
export const DEFAULT_SESSION_STATE_POLICY: BrowserProfileSessionStatePolicy = {
  mode: "cookies_only",
  storage: "local",
  checkpointIntervalSec: 60,
};


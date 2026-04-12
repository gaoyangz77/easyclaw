import { createLogger } from "@rivonclaw/logger";
import { GatewayRpcClient, readExistingConfig } from "@rivonclaw/gateway";
import type { GatewayEventFrame } from "@rivonclaw/gateway";
import { getCsRelayWsUrl } from "@rivonclaw/core";
import type { CatalogTool } from "@rivonclaw/core";
import { join } from "node:path";
import { setRpcClient, getRpcClient } from "./rpc-client-ref.js";
import { pushStoredCookiesToGateway } from "../browser-profiles/cookie-sync.js";
import { CustomerServiceBridge } from "../cs-bridge/customer-service-bridge.js";
import { rootStore } from "../app/store/desktop-store.js";
import { runtimeStatusStore } from "../app/store/runtime-status-store.js";
import type { GatewayEventHandler } from "./event-dispatcher.js";
import { getAuthSession } from "../auth/session-ref.js";
import { loadClientToolSpecs } from "./client-tool-loader.js";


const log = createLogger("gateway-connection");

// ── Module-level state ─────────────────────────────────────────────────────

let _csBridge: CustomerServiceBridge | null = null;

// ── Deps interface ─────────────────────────────────────────────────────────

export interface GatewayConnectionDeps {
  configPath: string;
  stateDir: string;
  deviceId: string;
  gatewayPort: number;
  storage: {
    mobilePairings: {
      getAllPairings(): Array<{
        id: string;
        pairingId?: string;
        accessToken: string;
        relayUrl: string;
        deviceId: string;
        mobileDeviceId?: string;
        status?: "active" | "stale";
      }>;
    };
  };
  toolCapability: {
    init(catalogTools: CatalogTool[], ourPluginIds: ReadonlySet<string>): void;
  };
  dispatchGatewayEvent: GatewayEventHandler;
  ourPluginIds: ReadonlySet<string>;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function getCsBridge(): CustomerServiceBridge | null {
  return _csBridge;
}

export async function connectGateway(deps: GatewayConnectionDeps): Promise<void> {
  const existing = getRpcClient();
  if (existing) {
    existing.stop();
  }

  const {
    configPath,
    stateDir,
    deviceId,
    gatewayPort,
    storage,
    toolCapability,
    dispatchGatewayEvent,
    ourPluginIds,
  } = deps;

  const config = readExistingConfig(configPath);
  const gw = config.gateway as Record<string, unknown> | undefined;
  const port = (gw?.port as number) ?? gatewayPort;
  const auth = gw?.auth as Record<string, unknown> | undefined;
  const token = auth?.token as string | undefined;

  const rpcClient = new GatewayRpcClient({
    url: `ws://127.0.0.1:${port}`,
    token,
    deviceIdentityPath: join(stateDir, "identity", "device.json"),
    onConnect: () => {
      log.info("Gateway RPC client connected");
      runtimeStatusStore.setGatewayRpcConnected(true);

      // Start Mobile Sync engines for all active pairings (skip stale)
      const allPairings = storage.mobilePairings.getAllPairings();
      const stalePairings: Array<{ pairingId: string | undefined; mobileDeviceId: string | undefined }> = [];
      for (const pairing of allPairings) {
        if (pairing.status === "stale") {
          stalePairings.push({
            pairingId: pairing.pairingId || pairing.id,
            mobileDeviceId: pairing.mobileDeviceId,
          });
          continue;
        }
        rpcClient.request("mobile_chat_start_sync", {
          pairingId: pairing.pairingId,
          accessToken: pairing.accessToken,
          relayUrl: pairing.relayUrl,
          desktopDeviceId: pairing.deviceId,
          mobileDeviceId: pairing.mobileDeviceId || pairing.id,
        }).catch((e: unknown) => log.error(`Failed to start Mobile Sync for ${pairing.pairingId || pairing.mobileDeviceId || pairing.id}:`, e));
      }

      // Register stale pairings so the mobile channel stays visible in Panel
      if (stalePairings.length > 0) {
        rpcClient.request("mobile_chat_register_stale", { pairings: stalePairings })
          .catch((e: unknown) => log.error("Failed to register stale mobile pairings:", e));
      }

      // Initialize event bridge plugin so it captures the gateway broadcast function
      rpcClient.request("event_bridge_init", {})
        .catch((e: unknown) => log.debug("Event bridge init (may not be loaded):", e));

      // Initialize ToolCapability with gateway tool catalog + entitlements.
      // After loading the catalog, fetch essential entity data (ToolSpecs,
      // user, RunProfiles, Surfaces) so the capability resolver has complete
      // data before the first agent dispatch — not dependent on Panel loading.
      (async () => {
        try {
          const catalog = await rpcClient.request<{
            groups: Array<{
              tools: Array<{ id: string; source: "core" | "plugin"; pluginId?: string }>;
            }>;
          }>("tools.catalog", { includePlugins: true });

          const catalogTools: CatalogTool[] = [];
          for (const group of catalog.groups ?? []) {
            for (const tool of group.tools ?? []) {
              catalogTools.push({ id: tool.id, source: tool.source, pluginId: tool.pluginId });
            }
          }

          // Fetch essential entity data before marking initialized.
          // These are the same queries Panel sends in initSession(), but
          // Desktop needs them independently in case Panel hasn't loaded yet.
          const authSession = getAuthSession();
          if (authSession) {
            const essentials = [
              "query ToolSpecsSync { toolSpecs { id name category displayName description surfaces runProfiles graphqlOperation operationType parameters { name type description graphqlVar required defaultValue enumValues } contextBindings { paramName contextField } restMethod restEndpoint restContentType supportedPlatforms } }",
              "query { me { id email name plan createdAt enrolledModules entitlementKeys defaultRunProfileId llmKey { key suspendedUntil } } }",
              "query { surfaces { id name userId allowedToolIds } }",
              "query { runProfiles { id name userId surfaceId selectedToolIds } }",
            ];
            const results = await Promise.allSettled(
              essentials.map(q => authSession.graphqlFetch(q)),
            );
            for (const r of results) {
              if (r.status === "fulfilled" && r.value && typeof r.value === "object") {
                try {
                  rootStore.ingestGraphQLResponse(r.value as Record<string, unknown>);
                } catch { /* best-effort — don't block init */ }
              }
            }
          }

          toolCapability.init(catalogTools, ourPluginIds);
        } catch (e) {
          log.warn("Failed to initialize ToolCapability:", e);
        }
      })();

      // Load client tool specs from the rivonclaw-local-tools plugin via RPC
      loadClientToolSpecs(rpcClient).catch((e: unknown) =>
        log.warn("Failed to load client tool specs:", e),
      );

      // Start CS Bridge if user has e-commerce module.
      // Also registers a listener so the bridge starts when user data arrives
      // after gateway connect (e.g. ME_QUERY was slow or failed on first try).
      tryStartCsBridge(deviceId ?? "unknown");

      // Push locally-stored cookies for managed profiles to the gateway plugin
      pushStoredCookiesToGateway()
        .catch((e: unknown) => log.debug("Failed to push stored cookies to gateway (best-effort):", e));
    },
    onClose: () => {
      log.info("Gateway RPC client disconnected");
      runtimeStatusStore.setGatewayRpcConnected(false);
    },
    onEvent: (evt: GatewayEventFrame) => {
      // Forward events to CS bridge for auto-forwarding agent text to buyer
      _csBridge?.onGatewayEvent(evt);
      dispatchGatewayEvent(evt);
    },
  });

  setRpcClient(rpcClient);
  await rpcClient.start();
}

export function disconnectGateway(): void {
  if (_csBridge) {
    _csBridge.stop();
    _csBridge = null;
  }
  const rpcClient = getRpcClient();
  if (rpcClient) {
    rpcClient.stop();
    setRpcClient(null);
  }
}

// ---------------------------------------------------------------------------
// CS Bridge reactive startup
// ---------------------------------------------------------------------------
// The bridge must start when BOTH conditions are met:
//   1. Gateway RPC is connected (we can dispatch agent runs)
//   2. User data shows ecommerce module enrolled
// These can arrive in any order (ME_QUERY may fail on first try due to
// network issues). We register an onUserChanged listener so the bridge
// starts as soon as user data arrives, even if gateway connected earlier.

let _csBridgeListenerRegistered = false;

export function tryStartCsBridge(gatewayId: string): void {
  const authSession = getAuthSession();
  if (!authSession) return;

  const attemptStart = () => {
    // Both conditions: RPC connected + user has ecommerce
    if (!getRpcClient()) return;
    const user = authSession.getCachedUser();
    const hasEcommerce = user?.enrolledModules?.includes("GLOBAL_ECOMMERCE_SELLER");
    if (!hasEcommerce) return;
    if (_csBridge) return; // Already running

    _csBridge = new CustomerServiceBridge({
      relayUrl: getCsRelayWsUrl(),
      gatewayId,
    });
    rootStore.llmManager.refreshModelCatalog().catch(() => {});
    _csBridge.start().catch((e: unknown) => log.error("CS bridge start failed:", e));
    log.info("CS bridge started (ecommerce module detected)");
  };

  // Try immediately (user data may already be cached)
  attemptStart();

  // Register listener for when user data arrives later (only once)
  if (!_csBridgeListenerRegistered) {
    _csBridgeListenerRegistered = true;
    authSession.onUserChanged(() => attemptStart());
  }
}

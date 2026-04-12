import { createLogger } from "@rivonclaw/logger";
import { getCsRelayWsUrl } from "@rivonclaw/core";
import { openClawConnector } from "../openclaw/index.js";
import { CustomerServiceBridge } from "../cs-bridge/customer-service-bridge.js";
import { rootStore } from "../app/store/desktop-store.js";
import { getAuthSession } from "../auth/session-ref.js";


const log = createLogger("gateway-connection");

// ── Module-level state ─────────────────────────────────────────────────────

let _csBridge: CustomerServiceBridge | null = null;

// ── Public API ─────────────────────────────────────────────────────────────

export function getCsBridge(): CustomerServiceBridge | null {
  return _csBridge;
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
    let rpc: unknown;
    try { rpc = openClawConnector.ensureRpcReady(); } catch { rpc = null; }
    if (!rpc) return;
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

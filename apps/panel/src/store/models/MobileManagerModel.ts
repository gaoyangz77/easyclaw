import { types, flow } from "mobx-state-tree";
import { fetchJson } from "../../api/client.js";

/** Fired after any mobile pairing configuration change. */
const MOBILE_CHANGED_EVENT = "mobile-changed";

/**
 * Mobile pairing management operations as MST actions on the Panel entity store.
 *
 * Holds no observable state -- mobile pairings live on rootStore.mobilePairings.
 * This is an action container mounted as `entityStore.mobileManager`.
 */
export const MobileManagerModel = types
  .model("MobileManager", {})
  .actions((self) => {
    function broadcast(): void {
      window.dispatchEvent(new CustomEvent(MOBILE_CHANGED_EVENT));
    }

    return {
      /** Request a new pairing code from the control plane. */
      requestPairingCode: flow(function* () {
        return yield fetchJson("/mobile/pairing-code/generate", { method: "POST" });
      }),

      /** Get install URL for the mobile PWA. */
      getInstallUrl: flow(function* () {
        return yield fetchJson("/mobile/install-url");
      }),

      /** Get pairing status (pairings list, activeCode, desktopDeviceId). */
      getStatus: flow(function* () {
        return yield fetchJson("/mobile/status");
      }),

      /** Get device-level presence status. */
      getDeviceStatus: flow(function* () {
        return yield fetchJson("/mobile/device-status");
      }),

      /** Disconnect all pairings. */
      disconnectAll: flow(function* () {
        yield fetchJson("/mobile/disconnect", { method: "DELETE" });
        broadcast();
      }),

      /** Broadcast mobile change to all listeners (for cross-page coordination). */
      broadcast,

      /** Subscribe to mobile pairing changes. Returns cleanup function. */
      onChange(callback: () => void): () => void {
        window.addEventListener(MOBILE_CHANGED_EVENT, callback);
        return () => window.removeEventListener(MOBILE_CHANGED_EVENT, callback);
      },
    };
  });

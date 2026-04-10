import { types, flow } from "mobx-state-tree";
import { fetchJson } from "../../api/client.js";
import { API, clientPath } from "@rivonclaw/core/api-contract";
import type { MobilePairingStatusResponse, MobileDeviceStatusResponse } from "../../api/mobile-chat.js";

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
  .actions((_self) => {
    function broadcast(): void {
      window.dispatchEvent(new CustomEvent(MOBILE_CHANGED_EVENT));
    }

    return {
      /** Request a new pairing code from the control plane. */
      requestPairingCode: flow(function* () {
        return yield fetchJson(clientPath(API["mobile.pairingCode"]), { method: "POST" });
      }),

      /** Get install URL for the mobile PWA. */
      getInstallUrl: flow(function* () {
        return yield fetchJson(clientPath(API["mobile.installUrl"]));
      }),

      /** Get pairing status (pairings list, activeCode, desktopDeviceId). */
      getStatus: flow(function* () {
        return (yield fetchJson(clientPath(API["mobile.status"]))) as MobilePairingStatusResponse;
      }),

      /** Get device-level presence status. */
      getDeviceStatus: flow(function* () {
        return (yield fetchJson(clientPath(API["mobile.deviceStatus"]))) as MobileDeviceStatusResponse;
      }),

      /** Disconnect all pairings. */
      disconnectAll: flow(function* () {
        yield fetchJson(clientPath(API["mobile.disconnect"]), { method: "DELETE" });
        broadcast();
      }),

      /** Disconnect a specific pairing by ID. */
      disconnectOne: flow(function* (pairingId: string) {
        yield fetchJson(
          clientPath(API["mobile.disconnect"]) + `?pairingId=${encodeURIComponent(pairingId)}`,
          { method: "DELETE" },
        );
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

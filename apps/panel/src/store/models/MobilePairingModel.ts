import { flow } from "mobx-state-tree";
import { MobilePairingModel as MobilePairingModelBase } from "@rivonclaw/core/models";
import { fetchJson } from "../../api/client.js";

export const MobilePairingModel = MobilePairingModelBase.actions((self) => ({
  /** Disconnect this specific pairing. */
  disconnect: flow(function* () {
    yield fetchJson(`/mobile/disconnect?pairingId=${encodeURIComponent(self.id)}`, {
      method: "DELETE",
    });
    // Desktop REST -> mobileManager.removePairing() -> Desktop MST -> SSE -> Panel auto-updates
  }),
}));

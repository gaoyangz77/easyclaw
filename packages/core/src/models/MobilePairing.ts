import { types, type Instance } from "mobx-state-tree";

export const MobilePairingModel = types.model("MobilePairing", {
  id: types.identifier,
  pairingId: types.maybeNull(types.string),
  deviceId: types.string,
  accessToken: types.string,
  relayUrl: types.string,
  createdAt: types.string,
  expiresAt: types.maybeNull(types.string),
  mobileDeviceId: types.maybeNull(types.string),
  name: types.maybeNull(types.string),
  status: types.optional(types.string, "active"),
});

export interface MobilePairing extends Instance<typeof MobilePairingModel> {}

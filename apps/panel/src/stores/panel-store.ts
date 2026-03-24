import { create } from "zustand";
import { setTokenGetter, setOnTokenRefreshed, setOnRefreshFailed } from "../api/apollo-client.js";
import { createAuthSlice } from "./slices/auth-slice.js";
import type { AuthSlice } from "./slices/auth-slice.js";
import { createSubscriptionSlice } from "./slices/subscription-slice.js";
import type { SubscriptionSlice } from "./slices/subscription-slice.js";
import { createSurfacesSlice } from "./slices/surfaces-slice.js";
import type { SurfacesSlice } from "./slices/surfaces-slice.js";
import { createRunProfilesSlice } from "./slices/run-profiles-slice.js";
import type { RunProfilesSlice } from "./slices/run-profiles-slice.js";
import { createAvailableToolsSlice } from "./slices/available-tools-slice.js";
import type { AvailableToolsSlice } from "./slices/available-tools-slice.js";
import { createProviderKeysSlice } from "./slices/provider-keys-slice.js";
import type { ProviderKeysSlice } from "./slices/provider-keys-slice.js";
import { createShopsSlice } from "./slices/shops-slice.js";
import type { ShopsSlice } from "./slices/shops-slice.js";
import { createModulesSlice } from "./slices/modules-slice.js";
import type { ModulesSlice } from "./slices/modules-slice.js";

export type PanelStore = AuthSlice &
  SubscriptionSlice &
  SurfacesSlice &
  RunProfilesSlice &
  AvailableToolsSlice &
  ProviderKeysSlice &
  ShopsSlice &
  ModulesSlice;

export const usePanelStore = create<PanelStore>()((...a) => ({
  ...createAuthSlice(...a),
  ...createSubscriptionSlice(...a),
  ...createSurfacesSlice(...a),
  ...createRunProfilesSlice(...a),
  ...createAvailableToolsSlice(...a),
  ...createProviderKeysSlice(...a),
  ...createShopsSlice(...a),
  ...createModulesSlice(...a),
}));

/** Call once before React tree mounts to wire Apollo client callbacks. */
export function initStoreBindings(): void {
  setTokenGetter(() => usePanelStore.getState().token);
  setOnTokenRefreshed((accessToken: string) =>
    usePanelStore.getState().setToken(accessToken),
  );
  setOnRefreshFailed(() => usePanelStore.getState().clearAuth());
}

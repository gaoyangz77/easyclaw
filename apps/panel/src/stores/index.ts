import { useShallow } from "zustand/react/shallow";
import type { GQL } from "@rivonclaw/core";
import { usePanelStore } from "./panel-store.js";

export { usePanelStore, initStoreBindings } from "./panel-store.js";
export type { PanelStore } from "./panel-store.js";

// Re-export GQL types that appear in inferred return types of convenience hooks.
// Without these, TS4023/TS4058 fires because TypeScript cannot name the types
// from the deep dist path of @rivonclaw/core.
export type MeResponse = GQL.MeResponse;
export type UserSubscription = GQL.UserSubscription;
export type LlmQuotaStatus = GQL.LlmQuotaStatus;
export type LoginInput = GQL.LoginInput;
export type RegisterInput = GQL.RegisterInput;

// Re-export domain types for convenience
export type { Surface } from "./slices/surfaces-slice.js";
export type { RunProfile } from "./slices/run-profiles-slice.js";
export type { ProviderKeyEntry } from "./slices/provider-keys-slice.js";
export type { Shop, ServiceCreditInfo, CSSessionStatsInfo } from "./slices/shops-slice.js";
export type { ModuleId } from "./slices/modules-slice.js";

// Convenience selector hooks
export const useUser = () => usePanelStore((s) => s.user);
export const useAuthLoading = () => usePanelStore((s) => s.authLoading);
export const useToken = () => usePanelStore((s) => s.token);
export const useSubscriptionStatus = () => usePanelStore((s) => s.subscriptionStatus);
export const useLlmQuota = () => usePanelStore((s) => s.llmQuota);
export const useSurfaces = () => usePanelStore((s) => s.surfaces);
export const useRunProfiles = () => usePanelStore((s) => s.runProfiles);
export const useProviderKeys = () => usePanelStore((s) => s.providerKeys);
export const useShops = () => usePanelStore((s) => s.shops);

/** Backward-compatible useAuth hook matching the shape of the old AuthProvider context. */
export function useAuth() {
  return usePanelStore(useShallow((s) => ({
    user: s.user,
    token: s.token,
    loading: s.authLoading,
    login: s.login,
    register: s.register,
    logout: s.logout,
  })));
}

/** Backward-compatible useToolRegistry hook matching the shape of the old ToolRegistryProvider context. */
export function useToolRegistry() {
  return usePanelStore(useShallow((s) => ({
    tools: s.availableTools,
    hasTools: s.availableTools.length > 0,
  })));
}

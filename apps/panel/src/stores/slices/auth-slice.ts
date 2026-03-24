import { GQL } from "@rivonclaw/core";
import type { StateCreator } from "zustand";
import { LOGIN_MUTATION, REGISTER_MUTATION, ME_QUERY } from "../../api/auth-queries.js";
import { getClient } from "../../api/apollo-client.js";
import { trackEvent } from "../../api/settings.js";
import type { PanelStore } from "../panel-store.js";

export interface AuthSlice {
  user: GQL.MeResponse | null;
  token: string | null;
  authLoading: boolean;

  initSession: () => Promise<void>;
  login: (input: GQL.LoginInput) => Promise<void>;
  register: (input: GQL.RegisterInput) => Promise<void>;
  logout: () => void;
  setToken: (token: string) => void;
  clearAuth: () => void;
}

const TOKEN_KEY = "rivonclaw.auth.token";
const REFRESH_KEY = "rivonclaw.auth.refreshToken";

export const createAuthSlice: StateCreator<PanelStore, [], [], AuthSlice> = (set, get) => ({
  user: null,
  token: null,
  authLoading: true,

  initSession: async () => {
    // One-time migration: push localStorage tokens to desktop, then remove
    const legacyToken = localStorage.getItem(TOKEN_KEY);
    if (legacyToken) {
      const legacyRefresh = localStorage.getItem(REFRESH_KEY);
      try {
        await fetch("/api/auth/store-tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: legacyToken,
            refreshToken: legacyRefresh,
          }),
        });
      } catch {
        // Migration is best-effort
      }
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
    }

    // Fetch current session from desktop
    try {
      const res = await fetch("/api/auth/session");
      if (res.ok) {
        const session = (await res.json()) as {
          accessToken: string | null;
          user: GQL.MeResponse | null;
        };
        if (session.accessToken) {
          if (session.user) {
            // Have both token and user — done
            set({ token: session.accessToken, user: session.user, authLoading: false });
            get().syncEnrolledModules((session.user.enrolledModules ?? []) as import("./modules-slice.js").ModuleId[]);
            // Fire-and-forget post-auth data fetches
            get().fetchSubscription();
            get().fetchLlmQuota();
            get().fetchSurfaces();
            get().fetchRunProfiles();
            get().fetchAvailableTools();
            get().fetchProviderKeys();
            return;
          }
          // Token exists but no cached user — validate via ME_QUERY
          set({ token: session.accessToken });
          try {
            const { data } = await getClient().query<{ me: GQL.MeResponse }>({
              query: ME_QUERY,
              fetchPolicy: "network-only",
            });
            if (data?.me) {
              set({ user: data.me, authLoading: false });
              get().syncEnrolledModules((data.me.enrolledModules ?? []) as import("./modules-slice.js").ModuleId[]);
              // Fire-and-forget post-auth data fetches
              get().fetchSubscription();
              get().fetchLlmQuota();
              get().fetchSurfaces();
              get().fetchRunProfiles();
              get().fetchAvailableTools();
              get().fetchProviderKeys();
              return;
            }
          } catch {
            // Token invalid — clear it
            set({ token: null, authLoading: false });
            return;
          }
        }
      }
    } catch {
      // Desktop unreachable — stay logged out
    }
    set({ authLoading: false });
    // Provider keys are local data — always load regardless of auth state
    get().fetchProviderKeys();
  },

  login: async (input: GQL.LoginInput) => {
    const { data } = await getClient().mutate<{ login: GQL.AuthPayload }>({
      mutation: LOGIN_MUTATION,
      variables: { input },
    });
    if (!data?.login) throw new Error("Login failed");
    const payload = data.login;
    await fetch("/api/auth/store-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
      }),
    });
    set({ token: payload.accessToken, user: payload.user });
    get().syncEnrolledModules((payload.user.enrolledModules ?? []) as import("./modules-slice.js").ModuleId[]);
    trackEvent("auth.login");
    // Fire-and-forget post-auth data fetches
    get().fetchSubscription();
    get().fetchLlmQuota();
    get().fetchSurfaces();
    get().fetchRunProfiles();
    get().fetchAvailableTools();
    get().fetchProviderKeys();
  },

  register: async (input: GQL.RegisterInput) => {
    const { data } = await getClient().mutate<{ register: GQL.AuthPayload }>({
      mutation: REGISTER_MUTATION,
      variables: { input },
    });
    if (!data?.register) throw new Error("Registration failed");
    const payload = data.register;
    await fetch("/api/auth/store-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
      }),
    });
    set({ token: payload.accessToken, user: payload.user });
    get().syncEnrolledModules((payload.user.enrolledModules ?? []) as import("./modules-slice.js").ModuleId[]);
    trackEvent("auth.register");
    // Fire-and-forget post-auth data fetches
    get().fetchSubscription();
    get().fetchLlmQuota();
    get().fetchSurfaces();
    get().fetchRunProfiles();
    get().fetchAvailableTools();
    get().fetchProviderKeys();
  },

  logout: () => {
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    trackEvent("auth.logout");
    set({ user: null, token: null });
    get().resetSubscription();
    get().resetSurfaces();
    get().resetRunProfiles();
    get().resetAvailableTools();
    // Re-fetch provider keys — cloud key will be removed by onUserChanged,
    // but local keys must remain visible
    get().fetchProviderKeys();
  },

  setToken: (token: string) => {
    set({ token });
  },

  clearAuth: () => {
    set({ user: null, token: null });
    get().resetSubscription();
    get().resetSurfaces();
    get().resetRunProfiles();
    get().resetAvailableTools();
    get().fetchProviderKeys();
  },
});

import type { StateCreator } from "zustand";
import {
  fetchShops as apiFetchShops,
  fetchPlatformApps as apiFetchPlatformApps,
  updateShop as apiUpdateShop,
  deleteShop as apiDeleteShop,
  initiateTikTokOAuth as apiInitiateTikTokOAuth,
  fetchMyCredits as apiFetchMyCredits,
  fetchCSSessionStats as apiFetchCSSessionStats,
  redeemCredit as apiRedeemCredit,
} from "../../api/shops.js";
import type { Shop, PlatformAppInfo, ServiceCreditInfo, CSSessionStatsInfo } from "../../api/shops.js";
import type { PanelStore } from "../panel-store.js";

export type { Shop, PlatformAppInfo, ServiceCreditInfo, CSSessionStatsInfo };

export interface ShopsSlice {
  shops: Shop[];
  shopsLoading: boolean;
  platformApps: PlatformAppInfo[];
  platformAppsLoading: boolean;

  // Credits
  credits: ServiceCreditInfo[];
  creditsLoading: boolean;

  // Session stats
  sessionStats: CSSessionStatsInfo | null;
  sessionStatsLoading: boolean;

  // Modal selection
  selectedShopId: string | null;

  fetchShops: () => Promise<void>;
  fetchPlatformApps: () => Promise<void>;
  updateShop: (
    id: string,
    input: {
      shopName?: string;
      authStatus?: string;
      region?: string;
      services?: { customerService?: { enabled?: boolean; businessPrompt?: string } };
    },
  ) => Promise<Shop>;
  deleteShop: (id: string) => Promise<void>;
  initiateTikTokOAuth: (platformAppId: string) => Promise<{ authUrl: string; state: string }>;
  fetchCredits: () => Promise<void>;
  fetchSessionStats: (shopId: string) => Promise<void>;
  redeemCredit: (creditId: string, shopId: string) => Promise<boolean>;
  setSelectedShopId: (shopId: string | null) => void;
  resetShops: () => void;
}

export const createShopsSlice: StateCreator<PanelStore, [], [], ShopsSlice> = (set) => ({
  shops: [],
  shopsLoading: false,
  platformApps: [],
  platformAppsLoading: false,
  credits: [],
  creditsLoading: false,
  sessionStats: null,
  sessionStatsLoading: false,
  selectedShopId: null,

  fetchShops: async () => {
    set({ shopsLoading: true });
    try {
      const list = await apiFetchShops();
      set({ shops: list, shopsLoading: false });
    } catch {
      set({ shopsLoading: false });
    }
  },

  fetchPlatformApps: async () => {
    set({ platformAppsLoading: true });
    try {
      const list = await apiFetchPlatformApps();
      set({ platformApps: list, platformAppsLoading: false });
    } catch {
      set({ platformAppsLoading: false });
    }
  },

  updateShop: async (id, input) => {
    const updated = await apiUpdateShop(id, input);
    set((state) => ({
      shops: state.shops.map((s) => (s.id === id ? updated : s)),
    }));
    return updated;
  },

  deleteShop: async (id) => {
    await apiDeleteShop(id);
    set((state) => ({
      shops: state.shops.filter((s) => s.id !== id),
    }));
  },

  initiateTikTokOAuth: async (platformAppId) => {
    return apiInitiateTikTokOAuth(platformAppId);
  },

  fetchCredits: async () => {
    set({ creditsLoading: true });
    try {
      const list = await apiFetchMyCredits();
      set({ credits: list, creditsLoading: false });
    } catch {
      set({ creditsLoading: false });
    }
  },

  fetchSessionStats: async (shopId) => {
    set({ sessionStatsLoading: true });
    try {
      const stats = await apiFetchCSSessionStats(shopId);
      set({ sessionStats: stats, sessionStatsLoading: false });
    } catch {
      set({ sessionStatsLoading: false });
    }
  },

  redeemCredit: async (creditId, shopId) => {
    const result = await apiRedeemCredit(creditId, shopId);
    // Refresh credits and shops after redemption
    const [credits, shops] = await Promise.all([apiFetchMyCredits(), apiFetchShops()]);
    set({ credits, shops });
    return result;
  },

  setSelectedShopId: (shopId) => {
    set({ selectedShopId: shopId });
  },

  resetShops: () => {
    set({
      shops: [],
      shopsLoading: false,
      platformApps: [],
      platformAppsLoading: false,
      credits: [],
      creditsLoading: false,
      sessionStats: null,
      sessionStatsLoading: false,
      selectedShopId: null,
    });
  },
});

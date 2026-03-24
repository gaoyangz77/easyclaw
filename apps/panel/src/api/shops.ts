import { getClient, trackedQuery } from "./apollo-client.js";
import {
  SHOPS_QUERY,
  SHOP_AUTH_STATUS_QUERY,
  PLATFORM_APPS_QUERY,
  UPDATE_SHOP_MUTATION,
  DELETE_SHOP_MUTATION,
  INITIATE_TIKTOK_OAUTH_MUTATION,
  MY_CREDITS_QUERY,
  CS_SESSION_STATS_QUERY,
  REDEEM_CREDIT_MUTATION,
} from "./shops-queries.js";

export interface CustomerServiceConfig {
  enabled: boolean;
  businessPrompt?: string;
}

export interface CustomerServiceBilling {
  tier?: string;
  balance: number;
  balanceExpiresAt?: string;
  periodEnd?: string;
}

export interface ShopServiceConfig {
  customerService: CustomerServiceConfig;
  customerServiceBilling?: CustomerServiceBilling;
}

export interface Shop {
  id: string;
  platform: string;
  platformAppId: string;
  platformShopId: string;
  shopName: string;
  authStatus: string;
  region: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  services: ShopServiceConfig;
}

export interface ShopAuthStatusInfo {
  hasToken: boolean;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
}

export interface PlatformAppInfo {
  id: string;
  platform: string;
  market: string;
  status: string;
  label: string;
  apiBaseUrl: string;
  authLinkUrl: string;
}

export interface ServiceCreditInfo {
  id: string;
  service: string;
  quota: number;
  status: string;
  expiresAt: string;
  source: string;
}

export interface CSSessionStatsInfo {
  activeSessions: number;
  totalSessions: number;
  balance: number;
  balanceExpiresAt?: string;
}

export async function fetchShops(): Promise<Shop[]> {
  return trackedQuery(async () => {
    const result = await getClient().query<{ shops: Shop[] }>({
      query: SHOPS_QUERY,
      fetchPolicy: "network-only",
    });
    return result.data!.shops;
  });
}

export async function fetchShopAuthStatus(id: string): Promise<ShopAuthStatusInfo> {
  return trackedQuery(async () => {
    const result = await getClient().query<{ shopAuthStatus: ShopAuthStatusInfo }>({
      query: SHOP_AUTH_STATUS_QUERY,
      variables: { id },
      fetchPolicy: "network-only",
    });
    return result.data!.shopAuthStatus;
  });
}

export async function fetchPlatformApps(): Promise<PlatformAppInfo[]> {
  return trackedQuery(async () => {
    const result = await getClient().query<{ platformApps: PlatformAppInfo[] }>({
      query: PLATFORM_APPS_QUERY,
      fetchPolicy: "network-only",
    });
    return result.data!.platformApps;
  });
}

export async function updateShop(
  id: string,
  input: {
    shopName?: string;
    authStatus?: string;
    region?: string;
    services?: { customerService?: { enabled?: boolean; businessPrompt?: string } };
  },
): Promise<Shop> {
  return trackedQuery(async () => {
    const result = await getClient().mutate<{ updateShop: Shop }>({
      mutation: UPDATE_SHOP_MUTATION,
      variables: { id, input },
      refetchQueries: [{ query: SHOPS_QUERY }],
    });
    return result.data!.updateShop;
  });
}

export async function deleteShop(id: string): Promise<boolean> {
  return trackedQuery(async () => {
    const result = await getClient().mutate<{ deleteShop: boolean }>({
      mutation: DELETE_SHOP_MUTATION,
      variables: { id },
      refetchQueries: [{ query: SHOPS_QUERY }],
    });
    return result.data!.deleteShop;
  });
}

export async function initiateTikTokOAuth(platformAppId: string): Promise<{ authUrl: string; state: string }> {
  return trackedQuery(async () => {
    const result = await getClient().mutate<{
      initiateTikTokOAuth: { authUrl: string; state: string };
    }>({
      mutation: INITIATE_TIKTOK_OAUTH_MUTATION,
      variables: { platformAppId },
    });
    return result.data!.initiateTikTokOAuth;
  });
}

export async function fetchMyCredits(): Promise<ServiceCreditInfo[]> {
  return trackedQuery(async () => {
    const result = await getClient().query<{ myCredits: ServiceCreditInfo[] }>({
      query: MY_CREDITS_QUERY,
      fetchPolicy: "network-only",
    });
    return result.data!.myCredits;
  });
}

export async function fetchCSSessionStats(shopId: string): Promise<CSSessionStatsInfo> {
  return trackedQuery(async () => {
    const result = await getClient().query<{ csSessionStats: CSSessionStatsInfo }>({
      query: CS_SESSION_STATS_QUERY,
      variables: { shopId },
      fetchPolicy: "network-only",
    });
    return result.data!.csSessionStats;
  });
}

export async function redeemCredit(creditId: string, shopId: string): Promise<boolean> {
  return trackedQuery(async () => {
    const result = await getClient().mutate<{ redeemCredit: boolean }>({
      mutation: REDEEM_CREDIT_MUTATION,
      variables: { creditId, shopId },
    });
    return result.data!.redeemCredit;
  });
}

import { gql } from "@apollo/client/core";

export const SHOP_FIELDS_FRAGMENT = gql`
  fragment ShopFields on Shop {
    id
    platform
    platformAppId
    platformShopId
    shopName
    authStatus
    region
    accessTokenExpiresAt
    refreshTokenExpiresAt
    services {
      customerService {
        enabled
        businessPrompt
      }
      customerServiceBilling {
        tier
        balance
        balanceExpiresAt
        periodEnd
      }
    }
  }
`;

export const SHOPS_QUERY = gql`
  ${SHOP_FIELDS_FRAGMENT}
  query Shops {
    shops {
      ...ShopFields
    }
  }
`;

export const SHOP_AUTH_STATUS_QUERY = gql`
  query ShopAuthStatus($id: ID!) {
    shopAuthStatus(id: $id) {
      hasToken
      accessTokenExpiresAt
      refreshTokenExpiresAt
    }
  }
`;

export const PLATFORM_APPS_QUERY = gql`
  query PlatformApps {
    platformApps {
      id
      platform
      market
      status
      label
      apiBaseUrl
      authLinkUrl
    }
  }
`;

export const CREATE_SHOP_MUTATION = gql`
  ${SHOP_FIELDS_FRAGMENT}
  mutation CreateShop($input: CreateShopInput!) {
    createShop(input: $input) {
      ...ShopFields
    }
  }
`;

export const UPDATE_SHOP_MUTATION = gql`
  ${SHOP_FIELDS_FRAGMENT}
  mutation UpdateShop($id: ID!, $input: UpdateShopInput!) {
    updateShop(id: $id, input: $input) {
      ...ShopFields
    }
  }
`;

export const DELETE_SHOP_MUTATION = gql`
  mutation DeleteShop($id: ID!) {
    deleteShop(id: $id)
  }
`;

export const INITIATE_TIKTOK_OAUTH_MUTATION = gql`
  mutation InitiateTikTokOAuth($platformAppId: ID!) {
    initiateTikTokOAuth(platformAppId: $platformAppId) {
      authUrl
      state
    }
  }
`;

export const COMPLETE_TIKTOK_OAUTH_MUTATION = gql`
  mutation CompleteTikTokOAuth($code: String!, $state: String!) {
    completeTikTokOAuth(code: $code, state: $state) {
      shopId
    }
  }
`;

export const MY_CREDITS_QUERY = gql`
  query MyCredits {
    myCredits {
      id
      service
      quota
      status
      expiresAt
      source
    }
  }
`;

export const CS_SESSION_STATS_QUERY = gql`
  query CSSessionStats($shopId: ID!) {
    csSessionStats(shopId: $shopId) {
      activeSessions
      totalSessions
      balance
      balanceExpiresAt
    }
  }
`;

export const REDEEM_CREDIT_MUTATION = gql`
  mutation RedeemCredit($creditId: ID!, $shopId: ID!) {
    redeemCredit(creditId: $creditId, shopId: $shopId)
  }
`;

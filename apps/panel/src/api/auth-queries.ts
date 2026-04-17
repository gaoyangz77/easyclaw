import { gql } from "@apollo/client/core";

export const REQUEST_CAPTCHA = gql`
  mutation RequestCaptcha {
    requestCaptcha {
      token
      svg
    }
  }
`;

export const LOGIN_MUTATION = gql`
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
      refreshToken
      user {
        userId
        email
        name
        plan
        createdAt
        enrolledModules
        entitlementKeys
        defaultRunProfileId
        llmKey {
          key
          suspendedUntil
        }
      }
    }
  }
`;

export const REGISTER_MUTATION = gql`
  mutation Register($input: RegisterInput!) {
    register(input: $input) {
      accessToken
      refreshToken
      user {
        userId
        email
        name
        plan
        createdAt
        enrolledModules
        entitlementKeys
        defaultRunProfileId
        llmKey {
          key
          suspendedUntil
        }
      }
    }
  }
`;

export const REFRESH_TOKEN_MUTATION = gql`
  mutation RefreshToken($refreshToken: String!) {
    refreshToken(refreshToken: $refreshToken) {
      accessToken
      refreshToken
      user {
        userId
        email
        name
        plan
        createdAt
        enrolledModules
        entitlementKeys
        defaultRunProfileId
        llmKey {
          key
          suspendedUntil
        }
      }
    }
  }
`;

const ME_FIELDS_FRAGMENT = gql`
  fragment MeFields on MeResponse {
    userId
    email
    name
    plan
    createdAt
    enrolledModules
    entitlementKeys
    defaultRunProfileId
    llmKey {
      key
      suspendedUntil
    }
  }
`;

export const ME_QUERY = gql`
  ${ME_FIELDS_FRAGMENT}
  query Me {
    me {
      ...MeFields
    }
  }
`;

export const ENROLL_MODULE_MUTATION = gql`
  ${ME_FIELDS_FRAGMENT}
  mutation EnrollModule($moduleId: ModuleId!) {
    enrollModule(moduleId: $moduleId) {
      ...MeFields
    }
  }
`;

export const UNENROLL_MODULE_MUTATION = gql`
  ${ME_FIELDS_FRAGMENT}
  mutation UnenrollModule($moduleId: ModuleId!) {
    unenrollModule(moduleId: $moduleId) {
      ...MeFields
    }
  }
`;

export const SET_DEFAULT_RUN_PROFILE_MUTATION = gql`
  ${ME_FIELDS_FRAGMENT}
  mutation SetDefaultRunProfile($runProfileId: String) {
    setDefaultRunProfile(runProfileId: $runProfileId) {
      ...MeFields
    }
  }
`;

export const PLAN_DEFINITIONS_QUERY = gql`
  query PlanDefinitions {
    planDefinitions {
      planId
      name
      maxSeats
      priceMonthly
      priceCurrency
    }
  }
`;

export const SUBSCRIPTION_STATUS_QUERY = gql`
  query SubscriptionStatus {
    subscriptionStatus {
      userId
      plan
      status
      seatsUsed
      seatsMax
      validUntil
    }
  }
`;

export const CHECKOUT_MUTATION = gql`
  mutation Checkout($planId: UserPlan!) {
    checkout(planId: $planId) {
      userId
      plan
      status
      seatsUsed
      seatsMax
      validUntil
    }
  }
`;

export const SEATS_QUERY = gql`
  query Seats {
    seats {
      userId
      gatewayId
      status
      connectedAt
      createdAt
    }
  }
`;

export const SEAT_USAGE_QUERY = gql`
  query SeatUsage($period: String) {
    seatUsage(period: $period) {
      userId
      seatId
      period
      messageCount
      inputTokens
      outputTokens
    }
  }
`;

export const ALLOCATE_SEAT_MUTATION = gql`
  mutation AllocateSeat($gatewayId: String!) {
    allocateSeat(gatewayId: $gatewayId) {
      userId
      gatewayId
      status
      connectedAt
    }
  }
`;

export const DEALLOCATE_SEAT_MUTATION = gql`
  mutation DeallocateSeat($seatId: String!) {
    deallocateSeat(seatId: $seatId)
  }
`;

export const LLM_QUOTA_STATUS_QUERY = gql`
  query LlmQuotaStatus {
    llmQuotaStatus {
      fiveHour {
        remainingPercent
        refreshAt
      }
      weekly {
        remainingPercent
        refreshAt
      }
    }
  }
`;

export const LOGOUT_MUTATION = gql`
  mutation Logout($refreshToken: String!) {
    logout(refreshToken: $refreshToken)
  }
`;

export const REVOKE_ALL_SESSIONS_MUTATION = gql`
  mutation RevokeAllSessions {
    revokeAllSessions
  }
`;

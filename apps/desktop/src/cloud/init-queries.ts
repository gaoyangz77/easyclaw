export const TOOL_SPECS_SYNC_QUERY = `
  query ToolSpecsSync {
    toolSpecs {
      id
      name
      category
      displayName
      description
      supportsPersistResult
      resultSchema
      surfaces
      runProfiles
      graphqlOperation
      operationType
      parameters {
        name
        type
        description
        graphqlVar
        required
        defaultValue
        enumValues
        isList
        children {
          name
          type
          description
          graphqlVar
          required
          defaultValue
          enumValues
          isList
          children {
            name
            type
            description
            graphqlVar
            required
            defaultValue
            enumValues
            isList
          }
        }
      }
      contextBindings {
        paramName
        contextField
      }
      restMethod
      restEndpoint
      restContentType
      supportedPlatforms
      prune
    }
  }
`;

export const INIT_ME_QUERY = `
  query {
    me {
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
`;

export const INIT_SURFACES_QUERY = `
  query {
    surfaces {
      id
      name
      description
      userId
      allowedToolIds
      createdAt
      updatedAt
    }
  }
`;

export const INIT_RUN_PROFILES_QUERY = `
  query {
    runProfiles {
      id
      name
      userId
      surfaceId
      selectedToolIds
    }
  }
`;

export const INIT_SHOPS_QUERY = `
  query {
    shops {
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
          runProfileId
          csDeviceId
          csProviderOverride
          csModelOverride
          escalationChannelId
          escalationRecipientId
          platformSystemPrompt
        }
        customerServiceBilling {
          tier
          balance
          balanceExpiresAt
          periodEnd
        }
      }
    }
  }
`;

export const INIT_PLATFORM_APPS_QUERY = `
  query {
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

export const INIT_CREDITS_QUERY = `
  query {
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

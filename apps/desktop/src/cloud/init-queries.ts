export const TOOL_SPECS_SYNC_QUERY = `
  query ToolSpecsSync {
    toolSpecs {
      id
      name
      category
      displayName
      description
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

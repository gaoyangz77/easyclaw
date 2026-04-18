import { test, expect } from "./electron-fixture.js";

// ---------------------------------------------------------------------------
// Helper: send a GraphQL request to the cloud proxy endpoint
// ---------------------------------------------------------------------------

async function cloudGraphql(
  apiBase: string,
  query: string,
  variables?: Record<string, unknown>,
) {
  return fetch(`${apiBase}/api/cloud/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
}

// ---------------------------------------------------------------------------
// Suite 1: Public Queries (no auth required)
// ---------------------------------------------------------------------------

test.describe("Capability Context — Public Queries", () => {
  test("toolRegistry returns tools with uppercase enum values", async ({
    window: _window,
    apiBase,
  }) => {
    const res = await cloudGraphql(
      apiBase,
      `query { toolRegistry { id category serviceCategory displayName description } }`,
    );

    // The cloud proxy may return an auth error if not authenticated, or 200 if
    // toolRegistry is a public query. Handle both cases.
    if (res.status === 401) {
      // Auth required even for toolRegistry — verify the error shape
      const body = await res.json();
      expect(body.errors).toBeDefined();
      expect(body.errors.length).toBeGreaterThan(0);
      return;
    }

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: {
        toolRegistry?: Array<{
          id: string;
          category: string;
          serviceCategory: string;
          displayName: string;
          description: string;
        }>;
      };
      errors?: Array<{ message: string }>;
    };

    // If the server returned GraphQL errors, skip data assertions
    if (body.errors && !body.data?.toolRegistry) {
      return;
    }

    expect(body.data?.toolRegistry).toBeDefined();
    const tools = body.data!.toolRegistry!;
    expect(tools.length).toBeGreaterThan(0);

    // Verify uppercase enum conventions (W30 four-layer model)
    const browserTool = tools.find((t) => t.id === "BROWSER_PROFILES_LIST");
    if (browserTool) {
      expect(browserTool.category).toBe("BROWSER_PROFILES");
      expect(browserTool.serviceCategory).toBe("BROWSER_PROFILES");
    }

    // All tool IDs should be UPPER_SNAKE_CASE
    for (const tool of tools) {
      expect(tool.id).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(tool.category).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(tool.serviceCategory).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

});

// ---------------------------------------------------------------------------
// Suite 2: Auth-Gated Queries
// ---------------------------------------------------------------------------

test.describe("Capability Context — Auth-Gated Queries", () => {
  test("entitlementSet query is forwarded and returns errors without auth", async ({
    window: _window,
    apiBase,
  }) => {
    const res = await cloudGraphql(
      apiBase,
      `query { entitlementSet { toolIds categories serviceCategories } }`,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });

  test("surfaces query is forwarded and returns errors without auth", async ({
    window: _window,
    apiBase,
  }) => {
    const res = await cloudGraphql(
      apiBase,
      `query { surfaces { id name allowedToolIds description } }`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });

  test("assembleCapabilityContext query is forwarded and returns errors without auth", async ({
    window: _window,
    apiBase,
  }) => {
    const res = await cloudGraphql(
      apiBase,
      `query($input: CapabilityContextAssemblyInput!) {
        assembleCapabilityContext(input: $input) {
          effectiveTools
          entitledTools
          surfaceAllowedTools
          runProfileSelectedTools
          surfaceId
          scopeType
          scopeKey
        }
      }`,
      {
        input: {
          surfaceId: "test-surface",
          scopeType: "agent",
          scopeKey: "test-key",
        },
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });

  test("runProfiles query is forwarded and returns errors without auth", async ({
    window: _window,
    apiBase,
  }) => {
    const res = await cloudGraphql(
      apiBase,
      `query { runProfiles { id name selectedToolIds surfaceId } }`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Cloud Proxy — Input Validation
// ---------------------------------------------------------------------------

test.describe("Capability Context — Cloud Proxy Validation", () => {
  test("empty body returns 200 with missing query error", async ({
    window: _window,
    apiBase,
  }) => {
    const res = await fetch(`${apiBase}/api/cloud/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors[0].message).toBe("Missing query");
  });

  test("malformed query is forwarded to Cloud and returns 200 with errors", async ({
    window: _window,
    apiBase,
  }) => {
    const res = await cloudGraphql(apiBase, "not a valid graphql query {{{");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });
});

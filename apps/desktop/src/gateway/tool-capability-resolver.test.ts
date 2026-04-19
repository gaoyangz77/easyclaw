import { describe, it, expect, beforeEach } from "vitest";
import { applySnapshot, getSnapshot } from "mobx-state-tree";
import { ScopeType } from "@rivonclaw/core";
import type { CatalogTool } from "@rivonclaw/core";
import { parseScopeType } from "./api.js";
import { rootStore } from "../app/store/desktop-store.js";
import { OUR_PLUGIN_IDS } from "../generated/our-plugin-ids.js";

// ---------------------------------------------------------------------------
// parseScopeType — pure function: sessionKey → ScopeType
// ---------------------------------------------------------------------------

describe("parseScopeType", () => {
  it('returns CHAT_SESSION for "agent:main:main"', () => {
    expect(parseScopeType("agent:main:main")).toBe(ScopeType.CHAT_SESSION);
  });

  it('returns CHAT_SESSION for panel session "agent:main:panel-abc123"', () => {
    expect(parseScopeType("agent:main:panel-abc123")).toBe(ScopeType.CHAT_SESSION);
  });

  it("returns CHAT_SESSION for Telegram direct message", () => {
    expect(parseScopeType("agent:main:telegram:direct:user123")).toBe(ScopeType.CHAT_SESSION);
  });

  it("returns CHAT_SESSION for Telegram group", () => {
    expect(parseScopeType("agent:main:telegram:group:group123")).toBe(ScopeType.CHAT_SESSION);
  });

  it("returns CHAT_SESSION for mobile direct message", () => {
    expect(parseScopeType("agent:main:mobile:direct:device123")).toBe(ScopeType.CHAT_SESSION);
  });

  it("returns CRON_JOB for cron session key", () => {
    expect(parseScopeType("agent:main:cron:job1:run:uuid")).toBe(ScopeType.CRON_JOB);
  });

  it("returns CS_SESSION for CS session (gateway-prefixed key)", () => {
    expect(parseScopeType("agent:main:cs:tiktok:conv123")).toBe(ScopeType.CS_SESSION);
  });

  it("defaults to CHAT_SESSION for unrecognized format", () => {
    expect(parseScopeType("random:unknown:key")).toBe(ScopeType.CHAT_SESSION);
  });

  it("defaults to CHAT_SESSION for empty string", () => {
    expect(parseScopeType("")).toBe(ScopeType.CHAT_SESSION);
  });
});

// ---------------------------------------------------------------------------
// ToolCapabilityModel.getEffectiveToolsForScope
// ---------------------------------------------------------------------------

/**
 * Helper: seed MST store and initialize toolCapability with deterministic mock data.
 *
 * System tools (core):  read, write, exec
 * Extension tool:       custom_ext_tool   (source=plugin, pluginId NOT in OUR_PLUGIN_IDS)
 * Entitled tools:       entitled_tool_1, entitled_tool_2  (from MST store)
 */
/** Required MST-model fields on every Surface fixture. */
const SURFACE_TIMESTAMPS = {
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

/** Set the default RunProfile on currentUser (the canonical source). */
function setDefaultRunProfile(runProfileId: string | null): void {
  if (rootStore.currentUser) {
    const snap = getSnapshot(rootStore.currentUser);
    applySnapshot(rootStore.currentUser, { ...snap, defaultRunProfileId: runProfileId } as any);
  }
}

function seedTestStore(): void {
  // Seed currentUser so toolCapability.defaultRunProfileId view has a source
  rootStore.setCurrentUser({
    userId: "test-user",
    email: "test@test.com",
    name: "Test",
    plan: "free",
    createdAt: "2026-01-01T00:00:00Z",
    enrolledModules: [],
    entitlementKeys: [],
    defaultRunProfileId: null as string | null,
    llmKey: null,
  });

  // Seed MST store with mock entitled tools
  rootStore.ingestGraphQLResponse({
    toolSpecs: [
      { id: "entitled_tool_1", name: "entitled_tool_1", displayName: "entitled_tool_1", description: "", category: "", operationType: "query", parameters: [] },
      { id: "entitled_tool_2", name: "entitled_tool_2", displayName: "entitled_tool_2", description: "", category: "", operationType: "query", parameters: [] },
    ],
    // Seed RunProfiles for use in tests
    runProfiles: [
      { id: "profile-entitled-1", name: "Entitled 1", selectedToolIds: ["entitled_tool_1"], surfaceId: "" },
      { id: "profile-entitled-2", name: "Entitled 2", selectedToolIds: ["entitled_tool_2"], surfaceId: "" },
      { id: "profile-ext", name: "Extension", selectedToolIds: ["custom_ext_tool"], surfaceId: "" },
      { id: "profile-both", name: "Both Entitled", selectedToolIds: ["entitled_tool_1", "entitled_tool_2"], surfaceId: "" },
      { id: "profile-restricted", name: "Restricted", selectedToolIds: ["entitled_tool_1", "entitled_tool_2"], surfaceId: "restricted-surface" },
      { id: "profile-cs-restricted", name: "CS Restricted", selectedToolIds: ["entitled_tool_1", "entitled_tool_2"], surfaceId: "cs-surface" },
    ],
  });

  const catalogTools: CatalogTool[] = [
    { id: "read", source: "core" },
    { id: "write", source: "core" },
    { id: "exec", source: "core" },
    // This plugin is in OUR_PLUGIN_IDS, so it should be excluded from customExtensionToolIds
    { id: "ecom_send_message", source: "plugin", pluginId: "rivonclaw-cloud-tools" },
    // This plugin is NOT in OUR_PLUGIN_IDS, so it becomes a custom extension tool
    { id: "custom_ext_tool", source: "plugin", pluginId: "my-custom-plugin" },
  ];

  rootStore.toolCapability.init(catalogTools, OUR_PLUGIN_IDS);
}

describe("ToolCapabilityModel.getEffectiveToolsForScope", () => {
  beforeEach(() => {
    rootStore.ingestGraphQLResponse({ toolSpecs: [], runProfiles: [], surfaces: [], shops: [] });
    seedTestStore();
    // Clear any session/default profiles
    setDefaultRunProfile(null);
  });

  // ── Trusted scopes ──

  it("trusted scope + no RunProfile + no default → system + extension tools", () => {
    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CHAT_SESSION, "agent:main:main");
    expect(result).toEqual(expect.arrayContaining(["read", "write", "exec", "custom_ext_tool"]));
    // Should not include entitled tools without a RunProfile
    expect(result).not.toContain("entitled_tool_1");
    expect(result).not.toContain("entitled_tool_2");
  });

  it("trusted scope + no RunProfile + has default → system + default's tools", () => {
    setDefaultRunProfile("profile-entitled-1");
    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CHAT_SESSION, "agent:main:main");
    expect(result).toEqual(expect.arrayContaining(["read", "write", "exec", "entitled_tool_1"]));
    expect(result).not.toContain("entitled_tool_2");
  });

  it("trusted scope + has RunProfile → system + profile's tools", () => {
    rootStore.toolCapability.setSessionRunProfile("agent:main:panel-abc", "profile-ext");
    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CHAT_SESSION, "agent:main:panel-abc");
    expect(result).toEqual(expect.arrayContaining(["read", "write", "exec", "custom_ext_tool"]));
  });

  it("trusted scope + RunProfile overrides default", () => {
    setDefaultRunProfile("profile-entitled-1");
    rootStore.toolCapability.setSessionRunProfile("agent:main:panel-abc", "profile-entitled-2");
    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CHAT_SESSION, "agent:main:panel-abc");
    expect(result).toEqual(expect.arrayContaining(["read", "write", "exec", "entitled_tool_2"]));
    expect(result).not.toContain("entitled_tool_1");
  });

  // ── Surface filtering via RunProfile's surfaceId ──

  it("RunProfile's parent surface restricts available tools", () => {
    // Create a user surface that only allows entitled_tool_1
    rootStore.ingestGraphQLResponse({
      surfaces: [
        { id: "restricted-surface", name: "Restricted", allowedToolIds: ["entitled_tool_1"], userId: "user1", ...SURFACE_TIMESTAMPS },
      ],
    });

    // Use profile-restricted which selects entitled_tool_1 AND entitled_tool_2, surfaceId = "restricted-surface"
    rootStore.toolCapability.setSessionRunProfile("agent:main:panel-abc", "profile-restricted");

    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CHAT_SESSION, "agent:main:panel-abc");
    // entitled_tool_1 passes (in surface AND in profile)
    expect(result).toContain("entitled_tool_1");
    // entitled_tool_2 blocked by surface (NOT in surface's allowedToolIds)
    expect(result).not.toContain("entitled_tool_2");
    // System tools still included (trusted scope)
    expect(result).toEqual(expect.arrayContaining(["read", "write", "exec"]));
  });

  it("CS_SESSION RunProfile respects surface restriction", () => {
    rootStore.ingestGraphQLResponse({
      surfaces: [
        { id: "cs-surface", name: "CS Surface", allowedToolIds: ["entitled_tool_1"], userId: "user1", ...SURFACE_TIMESTAMPS },
      ],
    });

    // Use profile-cs-restricted which selects entitled_tool_1 AND entitled_tool_2, surfaceId = "cs-surface"
    rootStore.toolCapability.setSessionRunProfile("cs:tiktok:conv-surface", "profile-cs-restricted");

    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CS_SESSION, "cs:tiktok:conv-surface");
    // Only entitled_tool_1 passes surface + profile intersection
    expect(result).toEqual(["entitled_tool_1"]);
  });

  // ── CS_SESSION (untrusted) ──

  it("CS_SESSION + has RunProfile → strictly profile tools, no system tools", () => {
    rootStore.toolCapability.setSessionRunProfile("cs:tiktok:conv1", "profile-entitled-1");
    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CS_SESSION, "cs:tiktok:conv1");
    expect(result).toEqual(["entitled_tool_1"]);
    expect(result).not.toContain("read");
    expect(result).not.toContain("write");
    expect(result).not.toContain("exec");
  });

  it("CS_SESSION + no RunProfile → empty (defense-in-depth)", () => {
    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CS_SESSION, "cs:tiktok:conv2");
    expect(result).toEqual([]);
  });

  it("CS_SESSION ignores default RunProfile", () => {
    setDefaultRunProfile("profile-entitled-1");
    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CS_SESSION, "cs:tiktok:conv3");
    expect(result).toEqual([]);
  });

  // ── UNKNOWN scope ──

  it("UNKNOWN scope + no RunProfile → empty", () => {
    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.UNKNOWN, "random:key");
    expect(result).toEqual([]);
  });

  // ── CRON_JOB (trusted) ──

  it("CRON_JOB is trusted → same as CHAT_SESSION behavior", () => {
    setDefaultRunProfile("profile-entitled-1");
    const result = rootStore.toolCapability.getEffectiveToolsForScope(
      ScopeType.CRON_JOB,
      "agent:main:cron:job1:run:uuid",
    );
    expect(result).toEqual(expect.arrayContaining(["read", "write", "exec", "entitled_tool_1"]));
  });

  // ── Clear session RunProfile ──

  it("clear session RunProfile → falls back to default", () => {
    setDefaultRunProfile("profile-entitled-1");
    rootStore.toolCapability.setSessionRunProfile("agent:main:panel-abc", "profile-entitled-2");

    // With session profile: entitled_tool_2
    let result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CHAT_SESSION, "agent:main:panel-abc");
    expect(result).toEqual(expect.arrayContaining(["entitled_tool_2"]));
    expect(result).not.toContain("entitled_tool_1");

    // Clear session profile
    rootStore.toolCapability.setSessionRunProfile("agent:main:panel-abc", null);

    // Should fall back to default: entitled_tool_1
    result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CHAT_SESSION, "agent:main:panel-abc");
    expect(result).toEqual(expect.arrayContaining(["read", "write", "exec", "entitled_tool_1"]));
    expect(result).not.toContain("entitled_tool_2");
  });

  it("clear session RunProfile with no default → system + extension tools for trusted scope", () => {
    rootStore.toolCapability.setSessionRunProfile("agent:main:panel-abc", "profile-entitled-2");

    // Clear session profile, no default set
    rootStore.toolCapability.setSessionRunProfile("agent:main:panel-abc", null);

    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CHAT_SESSION, "agent:main:panel-abc");
    expect(result).toEqual(expect.arrayContaining(["read", "write", "exec", "custom_ext_tool"]));
    expect(result).not.toContain("entitled_tool_2");
  });
});

// ---------------------------------------------------------------------------
// Map-indexed views (surfacesById, runProfilesById)
// ---------------------------------------------------------------------------

describe("Map-indexed views", () => {
  beforeEach(() => {
    rootStore.ingestGraphQLResponse({ toolSpecs: [], runProfiles: [], surfaces: [], shops: [] });
    seedTestStore();
  });

  it("surfacesById contains Default + system + user surfaces", () => {
    rootStore.ingestGraphQLResponse({
      surfaces: [
        { id: "user-surface", name: "User", allowedToolIds: ["entitled_tool_1"], userId: "u1", ...SURFACE_TIMESTAMPS },
      ],
    });
    const map = rootStore.toolCapability.surfacesById;
    expect(map.get("Default")).toBeDefined();
    expect(map.get("user-surface")).toBeDefined();
    expect(map.get("user-surface")!.resolvedToolIds).toEqual(["entitled_tool_1"]);
  });

  it("runProfilesById indexes all profiles by ID", () => {
    // seedTestStore already ingests run profiles
    const map = rootStore.toolCapability.runProfilesById;
    expect(map.get("profile-entitled-1")).toBeDefined();
    expect(map.get("profile-entitled-1")!.selectedToolIds).toEqual(["entitled_tool_1"]);
    expect(map.get("nonexistent")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Deleted/missing RunProfile and Surface
// ---------------------------------------------------------------------------

describe("deleted entity fallback", () => {
  beforeEach(() => {
    rootStore.ingestGraphQLResponse({ toolSpecs: [], runProfiles: [], surfaces: [], shops: [] });
    seedTestStore();
    setDefaultRunProfile(null);
  });

  it("session references deleted RunProfile → empty effectiveToolIds", () => {
    rootStore.toolCapability.setSessionRunProfile("agent:main:panel-x", "nonexistent-profile");
    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CS_SESSION, "agent:main:panel-x");
    // CS_SESSION (untrusted) + deleted profile → no tools
    expect(result).toEqual([]);
  });

  it("session references deleted RunProfile (trusted scope) → system tools only", () => {
    rootStore.toolCapability.setSessionRunProfile("agent:main:panel-x", "nonexistent-profile");
    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CHAT_SESSION, "agent:main:panel-x");
    // Trusted scope + deleted profile → computeEffectiveTools returns empty, but system tools merged back
    expect(result).toEqual(expect.arrayContaining(["read", "write", "exec"]));
    expect(result).not.toContain("entitled_tool_1");
  });

  it("RunProfile references deleted Surface → falls back to unrestricted (Default)", () => {
    // Create a profile that references a non-existent surface
    rootStore.ingestGraphQLResponse({
      runProfiles: [
        { id: "profile-ghost-surface", name: "Ghost", selectedToolIds: ["entitled_tool_1", "entitled_tool_2"], surfaceId: "deleted-surface" },
      ],
    });
    rootStore.toolCapability.setSessionRunProfile("agent:main:panel-x", "profile-ghost-surface");
    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CHAT_SESSION, "agent:main:panel-x");
    // Surface not found → unrestricted → both entitled tools pass through
    expect(result).toContain("entitled_tool_1");
    expect(result).toContain("entitled_tool_2");
  });
});

// ---------------------------------------------------------------------------
// computeSurfaceAvailability — system vs user surface behavior
// ---------------------------------------------------------------------------

describe("computeSurfaceAvailability — system vs user surface", () => {
  beforeEach(() => {
    rootStore.ingestGraphQLResponse({ toolSpecs: [], runProfiles: [], surfaces: [], shops: [] });
    seedTestStore();
  });

  it("system surface (empty userId) always passes system tools through", () => {
    const result = rootStore.toolCapability.computeSurfaceAvailability({
      id: "sys-surface",
      allowedToolIds: ["entitled_tool_1"],
      userId: "",  // system surface
    });
    // System tools pass through even though not in allowedToolIds
    expect(result.availableToolIds).toContain("read");
    expect(result.availableToolIds).toContain("write");
    expect(result.availableToolIds).toContain("exec");
    // Entitled tool in allowedToolIds also passes
    expect(result.availableToolIds).toContain("entitled_tool_1");
    // Entitled tool NOT in allowedToolIds is blocked
    expect(result.availableToolIds).not.toContain("entitled_tool_2");
  });

  it("user surface (non-empty userId) does NOT auto-include system tools", () => {
    const result = rootStore.toolCapability.computeSurfaceAvailability({
      id: "user-surface",
      allowedToolIds: ["entitled_tool_1"],
      userId: "user1",  // user surface — strict
    });
    // Only explicitly allowed tools pass
    expect(result.availableToolIds).toEqual(["entitled_tool_1"]);
    // System tools blocked (not in allowedToolIds)
    expect(result.availableToolIds).not.toContain("read");
  });

  it("null surface → all tools available (unrestricted)", () => {
    const result = rootStore.toolCapability.computeSurfaceAvailability(null);
    expect(result.availableToolIds).toEqual(result.allAvailableToolIds);
  });
});

// ---------------------------------------------------------------------------
// Default profile + Surface filtering
// ---------------------------------------------------------------------------

describe("default profile + Surface filtering", () => {
  beforeEach(() => {
    rootStore.ingestGraphQLResponse({ toolSpecs: [], runProfiles: [], surfaces: [], shops: [] });
    seedTestStore();
    setDefaultRunProfile(null);
  });

  it("default profile's surface restriction is enforced", () => {
    // Surface allows only entitled_tool_1
    rootStore.ingestGraphQLResponse({
      surfaces: [
        { id: "default-surface", name: "Default Restricted", allowedToolIds: ["entitled_tool_1"], userId: "u1", ...SURFACE_TIMESTAMPS },
      ],
      runProfiles: [
        { id: "profile-default-restricted", name: "Default Restricted", selectedToolIds: ["entitled_tool_1", "entitled_tool_2"], surfaceId: "default-surface" },
      ],
    });
    setDefaultRunProfile("profile-default-restricted");

    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CHAT_SESSION, "agent:main:main");
    // entitled_tool_1 passes surface + profile
    expect(result).toContain("entitled_tool_1");
    // entitled_tool_2 blocked by surface
    expect(result).not.toContain("entitled_tool_2");
    // System tools always included for trusted scope
    expect(result).toEqual(expect.arrayContaining(["read", "write", "exec"]));
  });

  it("session profile overrides default, each with own surface", () => {
    rootStore.ingestGraphQLResponse({
      surfaces: [
        { id: "broad-surface", name: "Broad", allowedToolIds: ["entitled_tool_1", "entitled_tool_2"], userId: "u1", ...SURFACE_TIMESTAMPS },
        { id: "narrow-surface", name: "Narrow", allowedToolIds: ["entitled_tool_2"], userId: "u1", ...SURFACE_TIMESTAMPS },
      ],
      runProfiles: [
        { id: "profile-broad", name: "Broad", selectedToolIds: ["entitled_tool_1", "entitled_tool_2"], surfaceId: "broad-surface" },
        { id: "profile-narrow", name: "Narrow", selectedToolIds: ["entitled_tool_1", "entitled_tool_2"], surfaceId: "narrow-surface" },
      ],
    });

    setDefaultRunProfile("profile-broad");
    rootStore.toolCapability.setSessionRunProfile("agent:main:panel-x", "profile-narrow");

    const result = rootStore.toolCapability.getEffectiveToolsForScope(ScopeType.CHAT_SESSION, "agent:main:panel-x");
    // Session profile's narrow surface only allows entitled_tool_2
    expect(result).toContain("entitled_tool_2");
    expect(result).not.toContain("entitled_tool_1");
  });
});

// ---------------------------------------------------------------------------
// ToolCapabilityModel.init — catalog classification
// ---------------------------------------------------------------------------

describe("ToolCapabilityModel.init", () => {
  beforeEach(() => {
    rootStore.ingestGraphQLResponse({ toolSpecs: [], runProfiles: [], surfaces: [], shops: [] });
    // Reset toolCapability to a clean state (no pre-seeded catalog, not initialized)
    applySnapshot(rootStore.toolCapability, {});
  });

  it("classifies core tools as system tools", () => {
    rootStore.toolCapability.init([
      { id: "read", source: "core" },
      { id: "write", source: "core" },
    ], OUR_PLUGIN_IDS);
    expect(rootStore.toolCapability.systemToolIds).toEqual(["read", "write"]);
  });

  it("excludes OUR_PLUGIN_IDS plugin tools from custom extensions", () => {
    rootStore.toolCapability.init([
      { id: "read", source: "core" },
      { id: "infra_tool", source: "plugin", pluginId: "rivonclaw-capability-manager" },
    ], OUR_PLUGIN_IDS);
    const all = rootStore.toolCapability.allAvailableToolIds;
    expect(all).toContain("read");
    expect(all).not.toContain("infra_tool");
  });

  it("includes non-OUR_PLUGIN_IDS plugin tools as custom extensions", () => {
    rootStore.toolCapability.init([
      { id: "read", source: "core" },
      { id: "my_tool", source: "plugin", pluginId: "my-custom-plugin" },
    ], OUR_PLUGIN_IDS);
    const all = rootStore.toolCapability.allAvailableToolIds;
    expect(all).toContain("my_tool");
  });

  it("sets initialized flag", () => {
    expect(rootStore.toolCapability.initialized).toBe(false);
    rootStore.toolCapability.init([], OUR_PLUGIN_IDS);
    expect(rootStore.toolCapability.initialized).toBe(true);
  });
});

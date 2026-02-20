import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import type { CatalogModelEntry } from "./model-catalog.js";
import { ALL_PROVIDERS, getProviderMeta } from "@easyclaw/core";

// vi.hoisted runs before vi.mock hoisting, so mocks are available in the factory
const mocks = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(false) as ReturnType<typeof vi.fn>,
  readFileSync: vi.fn().mockReturnValue("{}") as ReturnType<typeof vi.fn>,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: mocks.existsSync,
    readFileSync: mocks.readFileSync,
  };
});

vi.mock("./vendor.js", () => ({
  resolveVendorDir: () => "/tmp/fake-vendor",
}));

function entry(id: string, name?: string): CatalogModelEntry {
  return { id, name: name ?? id };
}

// Import after mocking
const { normalizeCatalog, readGatewayModelCatalog, readFullModelCatalog } = await import("./model-catalog.js");

describe("normalizeCatalog", () => {
  it("should keep 'zai' and 'zhipu' as separate providers", () => {
    const catalog = {
      zai: [entry("glm-4.7", "GLM 4.7"), entry("glm-4.7-flash", "GLM 4.7 Flash")],
      zhipu: [entry("glm-4-plus", "GLM-4 Plus")],
    };
    const result = normalizeCatalog(catalog);
    expect(result.zai).toBeDefined();
    expect(result.zai!.length).toBe(2);
    expect(result.zhipu).toBeDefined();
    expect(result.zhipu!.length).toBe(1);
  });

  it("should keep 'zhipu' and 'zhipu-coding' as separate providers", () => {
    const catalog = {
      zhipu: [entry("glm-5", "GLM-5")],
      "zhipu-coding": [entry("glm-5", "GLM-5"), entry("glm-4.7", "GLM 4.7")],
    };
    const result = normalizeCatalog(catalog);
    expect(result.zhipu).toBeDefined();
    expect(result.zhipu!.length).toBe(1);
    expect(result["zhipu-coding"]).toBeDefined();
    expect(result["zhipu-coding"]!.length).toBe(2);
  });

  it("should sort models in reverse alphabetical order by ID", () => {
    const catalog = {
      anthropic: [
        entry("claude-3-haiku-20240307", "Claude Haiku 3"),
        entry("claude-haiku-4-5-20251001", "Claude Haiku 4.5"),
        entry("claude-opus-4-6", "Claude Opus 4.6"),
        entry("claude-sonnet-4-20250514", "Claude Sonnet 4"),
      ],
    };
    const result = normalizeCatalog(catalog);
    expect(result.anthropic!.map((m) => m.id)).toEqual([
      "claude-sonnet-4-20250514",
      "claude-opus-4-6",
      "claude-haiku-4-5-20251001",
      "claude-3-haiku-20240307",
    ]);
  });

  it("should pass through all models without filtering", () => {
    const catalog = {
      openai: [
        entry("gpt-4", "GPT-4"),
        entry("gpt-4o", "GPT-4o"),
        entry("gpt-5.2", "GPT-5.2"),
        entry("o1", "o1"),
      ],
    };
    const result = normalizeCatalog(catalog);
    expect(result.openai!.length).toBe(4);
  });

  it("should normalize model IDs using provided aliases", () => {
    const aliases = { "gemini-3-pro": "gemini-3-pro-preview", "gemini-3-flash": "gemini-3-flash-preview" };
    const catalog = {
      "google-gemini-cli": [
        entry("gemini-3-pro", "Gemini 3 Pro"),
        entry("gemini-3-flash", "Gemini 3 Flash"),
      ],
    };
    const result = normalizeCatalog(catalog, aliases);
    expect(result["google-gemini-cli"]!.map((m) => m.id)).toEqual([
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
    ]);
  });

  it("should deduplicate after normalization", () => {
    const aliases = { "gemini-3-pro": "gemini-3-pro-preview" };
    const catalog = {
      "google-gemini-cli": [
        entry("gemini-3-pro", "Gemini 3 Pro"),
        entry("gemini-3-pro-preview", "Gemini 3 Pro Preview"),
      ],
    };
    const result = normalizeCatalog(catalog, aliases);
    expect(result["google-gemini-cli"]!.length).toBe(1);
    expect(result["google-gemini-cli"]![0].id).toBe("gemini-3-pro-preview");
  });

  it("should not touch model IDs when no aliases are provided", () => {
    const catalog = {
      openai: [entry("gpt-4o", "GPT-4o")],
      anthropic: [entry("claude-opus-4-6", "Claude Opus 4.6")],
    };
    const result = normalizeCatalog(catalog);
    expect(result.openai![0].id).toBe("gpt-4o");
    expect(result.anthropic![0].id).toBe("claude-opus-4-6");
  });

  it("should handle empty catalog", () => {
    const result = normalizeCatalog({});
    expect(Object.keys(result).length).toBe(0);
  });
});

describe("readGatewayModelCatalog", () => {
  beforeEach(() => {
    mocks.existsSync.mockReset().mockReturnValue(false);
    mocks.readFileSync.mockReset().mockReturnValue("{}");
  });

  it("should return empty object when models.json does not exist", () => {
    mocks.existsSync.mockReturnValue(false);
    const result = readGatewayModelCatalog({ EASYCLAW_STATE_DIR: "/tmp/fake" });
    expect(result).toEqual({});
  });

  it("should parse models.json correctly", () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify({
      providers: {
        openai: {
          models: [
            { id: "gpt-4o", name: "GPT-4o" },
            { id: "gpt-4o-mini", name: "GPT-4o Mini" },
          ],
        },
        anthropic: {
          models: [
            { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
          ],
        },
      },
    }));

    const result = readGatewayModelCatalog({ EASYCLAW_STATE_DIR: "/tmp/fake" });
    expect(Object.keys(result)).toContain("openai");
    expect(Object.keys(result)).toContain("anthropic");
    expect(result.openai).toHaveLength(2);
    expect(result.anthropic).toHaveLength(1);
  });

  it("should skip providers with empty model arrays", () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify({
      providers: {
        openai: { models: [] },
        anthropic: { models: [{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" }] },
      },
    }));

    const result = readGatewayModelCatalog({ EASYCLAW_STATE_DIR: "/tmp/fake" });
    expect(result.openai).toBeUndefined();
    expect(result.anthropic).toHaveLength(1);
  });
});

describe("readFullModelCatalog", () => {
  beforeEach(() => {
    mocks.existsSync.mockReset().mockReturnValue(false);
    mocks.readFileSync.mockReset().mockReturnValue("{}");
  });

  it("should return EXTRA_MODELS when no vendor or gateway data exists", async () => {
    // existsSync returns false → no vendor models.generated.js, no gateway models.json
    mocks.existsSync.mockReturnValue(false);
    const result = await readFullModelCatalog({ EASYCLAW_STATE_DIR: "/tmp/fake" });

    // Should contain extraModels providers (volcengine, zhipu, zhipu-coding)
    for (const provider of ALL_PROVIDERS) {
      if (!getProviderMeta(provider)?.extraModels) continue;
      expect(result[provider]).toBeDefined();
      expect(result[provider]!.length).toBeGreaterThan(0);
    }
  });

  it("should NOT contain phantom models (modelId === provider name)", async () => {
    mocks.existsSync.mockReturnValue(false);
    const result = await readFullModelCatalog({ EASYCLAW_STATE_DIR: "/tmp/fake" });

    for (const [provider, models] of Object.entries(result)) {
      for (const model of models) {
        expect(model.id).not.toBe(provider);
      }
    }
  });

  it("should merge gateway models with EXTRA_MODELS", async () => {
    // existsSync: true for gateway models.json path, false for vendor
    mocks.existsSync.mockImplementation((p: string) =>
      String(p).includes(join("agents", "main", "agent", "models.json")),
    );
    mocks.readFileSync.mockReturnValue(JSON.stringify({
      providers: {
        openai: {
          models: [{ id: "gpt-4o", name: "GPT-4o" }],
        },
      },
    }));

    const result = await readFullModelCatalog({ EASYCLAW_STATE_DIR: "/tmp/fake" });

    // Gateway provider
    expect(result.openai).toBeDefined();
    expect(result.openai![0].id).toBe("gpt-4o");

    // EXTRA_MODELS provider
    expect(result.volcengine).toBeDefined();
    expect(result.volcengine!.length).toBeGreaterThan(0);
  });

  it("should always populate KNOWN_MODELS (even with only EXTRA_MODELS)", async () => {
    mocks.existsSync.mockReturnValue(false);
    await readFullModelCatalog({ EASYCLAW_STATE_DIR: "/tmp/fake" });

    const { KNOWN_MODELS } = await import("@easyclaw/core");
    // At minimum, EXTRA_MODELS providers should be in KNOWN_MODELS
    expect(KNOWN_MODELS.volcengine).toBeDefined();
    expect(KNOWN_MODELS.volcengine!.length).toBeGreaterThan(0);
  });

  it("should populate KNOWN_MODELS with gateway models", async () => {
    mocks.existsSync.mockImplementation((p: string) =>
      String(p).includes(join("agents", "main", "agent", "models.json")),
    );
    mocks.readFileSync.mockReturnValue(JSON.stringify({
      providers: {
        openai: {
          models: [{ id: "gpt-4o", name: "GPT-4o" }],
        },
        anthropic: {
          models: [{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" }],
        },
      },
    }));

    await readFullModelCatalog({ EASYCLAW_STATE_DIR: "/tmp/fake" });

    const { KNOWN_MODELS } = await import("@easyclaw/core");
    expect(KNOWN_MODELS.openai).toBeDefined();
    expect(KNOWN_MODELS.openai!.length).toBeGreaterThan(0);
    expect(KNOWN_MODELS.openai![0].modelId).toBe("gpt-4o");
    expect(KNOWN_MODELS.anthropic).toBeDefined();
  });

  it("should inherit parent models for subscription plans without extraModels", async () => {
    mocks.existsSync.mockImplementation((p: string) =>
      String(p).includes(join("agents", "main", "agent", "models.json")),
    );
    mocks.readFileSync.mockReturnValue(JSON.stringify({
      providers: {
        anthropic: {
          models: [
            { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
            { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
          ],
        },
        google: {
          models: [
            { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
          ],
        },
        "google-gemini-cli": {
          models: [
            { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
            { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
          ],
        },
      },
    }));

    const result = await readFullModelCatalog({ EASYCLAW_STATE_DIR: "/tmp/fake" });

    // "claude" subscription plan should inherit anthropic's models
    expect(result.claude).toBeDefined();
    expect(result.claude!.length).toBe(2);
    expect(result.claude!.map((m) => m.id)).toContain("claude-sonnet-4-20250514");
    expect(result.claude!.map((m) => m.id)).toContain("claude-opus-4-6");

    // "gemini" subscription plan should inherit google-gemini-cli's models
    // (via catalogProvider: "google-gemini-cli" — OAuth tokens require Bearer auth)
    expect(result.gemini).toBeDefined();
    expect(result.gemini!.length).toBe(2);
    expect(result.gemini!.map((m) => m.id)).toContain("gemini-2.5-pro");
    expect(result.gemini!.map((m) => m.id)).toContain("gemini-2.5-flash");
  });

  it("should NOT override subscription plans that have their own extraModels", async () => {
    mocks.existsSync.mockReturnValue(false);
    const result = await readFullModelCatalog({ EASYCLAW_STATE_DIR: "/tmp/fake" });

    // "zhipu-coding" has its own extraModels and should keep them (not inherit zhipu's)
    expect(result["zhipu-coding"]).toBeDefined();
    expect(result["zhipu-coding"]!.some((m) => m.id === "glm-5")).toBe(true);
    // zhipu-coding should have fewer models than zhipu (6 vs 12)
    expect(result["zhipu-coding"]!.length).toBeLessThan(result.zhipu!.length);
  });
});

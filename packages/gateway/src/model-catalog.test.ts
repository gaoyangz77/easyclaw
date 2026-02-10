import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CatalogModelEntry } from "./model-catalog.js";
import { EXTRA_MODELS } from "@easyclaw/core";

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

    // Should contain EXTRA_MODELS providers (volcengine)
    for (const provider of Object.keys(EXTRA_MODELS)) {
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
      String(p).includes("agents/main/agent/models.json"),
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
      String(p).includes("agents/main/agent/models.json"),
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
});

import { describe, it, expect, beforeEach } from "vitest";
import {
  getDefaultModelForRegion,
  getDefaultModelForProvider,
  resolveModelConfig,
  getProvidersForRegion,
  getModelsForProvider,
  KNOWN_MODELS,
  PROVIDERS,
  ALL_PROVIDERS,
  initKnownModels,
  getProviderMeta,
  resolveGatewayProvider,
} from "./models.js";

describe("PROVIDERS extraModels", () => {
  it("should have volcengine models", () => {
    expect(PROVIDERS.volcengine.extraModels).toBeDefined();
    expect(PROVIDERS.volcengine.extraModels!.length).toBeGreaterThan(0);
  });

  it("should have valid model configs for all extraModels", () => {
    for (const provider of ALL_PROVIDERS) {
      const models = getProviderMeta(provider)?.extraModels;
      if (!models) continue;
      for (const model of models) {
        expect(model.provider).toBe(provider);
        expect(model.modelId).toBeTruthy();
        expect(model.displayName).toBeTruthy();
      }
    }
  });
});

describe("KNOWN_MODELS (before initKnownModels)", () => {
  it("should initially contain only extraModels providers", () => {
    // Before initKnownModels is called, KNOWN_MODELS only has providers with extraModels
    for (const provider of ALL_PROVIDERS) {
      if (!getProviderMeta(provider)?.extraModels) continue;
      expect(KNOWN_MODELS[provider]).toBeDefined();
    }
  });

  it("should have valid model configs", () => {
    for (const [provider, models] of Object.entries(KNOWN_MODELS)) {
      for (const model of models!) {
        expect(model.provider).toBe(provider);
        expect(model.modelId).toBeTruthy();
        expect(model.displayName).toBeTruthy();
      }
    }
  });
});

describe("initKnownModels", () => {
  it("should populate KNOWN_MODELS from catalog", () => {
    const catalog = {
      openai: [
        { id: "gpt-4o", name: "GPT-4o" },
        { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      ],
      anthropic: [
        { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      ],
      deepseek: [
        { id: "deepseek-chat", name: "DeepSeek Chat" },
      ],
    };

    initKnownModels(catalog);

    expect(KNOWN_MODELS.openai).toHaveLength(2);
    expect(KNOWN_MODELS.openai![0].modelId).toBe("gpt-4o");
    expect(KNOWN_MODELS.openai![0].provider).toBe("openai");
    expect(KNOWN_MODELS.anthropic).toHaveLength(1);
    expect(KNOWN_MODELS.deepseek).toHaveLength(1);
  });

  it("should keep extraModels providers over catalog", () => {
    const catalog = {
      volcengine: [
        { id: "some-other-model", name: "Other Model" },
      ],
    };

    initKnownModels(catalog);

    // extraModels take precedence — volcengine should still have our models
    expect(KNOWN_MODELS.volcengine).toEqual(PROVIDERS.volcengine.extraModels);
  });

  it("should ignore unknown providers", () => {
    const catalog = {
      "unknown-provider": [
        { id: "model-1", name: "Model 1" },
      ],
    };

    initKnownModels(catalog);

    expect(KNOWN_MODELS["unknown-provider" as keyof typeof KNOWN_MODELS]).toBeUndefined();
  });
});

describe("ALL_PROVIDERS / PROVIDERS", () => {
  it("should have labels for all providers", () => {
    for (const p of ALL_PROVIDERS) {
      expect(getProviderMeta(p)?.label).toBeTruthy();
    }
  });

  it("should include at least 10 providers", () => {
    expect(ALL_PROVIDERS.length).toBeGreaterThanOrEqual(10);
  });
});

describe("getDefaultModelForRegion", () => {
  it("should return GPT-4o for US region", () => {
    const model = getDefaultModelForRegion("us");
    expect(model.provider).toBe("openai");
    expect(model.modelId).toBe("gpt-4o");
  });

  it("should return GPT-4o for EU region", () => {
    const model = getDefaultModelForRegion("eu");
    expect(model.provider).toBe("openai");
    expect(model.modelId).toBe("gpt-4o");
  });

  it("should return DeepSeek Chat for CN region", () => {
    const model = getDefaultModelForRegion("cn");
    expect(model.provider).toBe("deepseek");
    expect(model.modelId).toBe("deepseek-chat");
  });

  it("should return global default for unknown region", () => {
    const model = getDefaultModelForRegion("jp");
    expect(model.provider).toBe("openai");
    expect(model.modelId).toBe("gpt-4o");
  });
});

describe("getDefaultModelForProvider", () => {
  beforeEach(() => {
    // Populate KNOWN_MODELS for these tests
    initKnownModels({
      openai: [{ id: "gpt-4o", name: "GPT-4o" }],
      anthropic: [{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" }],
      deepseek: [{ id: "deepseek-chat", name: "DeepSeek Chat" }],
    });
  });

  it("should return first model of given provider", () => {
    const model = getDefaultModelForProvider("anthropic");
    expect(model).toBeDefined();
    expect(model!.provider).toBe("anthropic");
    expect(model!.modelId).toBe("claude-sonnet-4-20250514");
  });

  it("should return first deepseek model", () => {
    const model = getDefaultModelForProvider("deepseek");
    expect(model).toBeDefined();
    expect(model!.provider).toBe("deepseek");
    expect(model!.modelId).toBe("deepseek-chat");
  });

  it("should return extraModels data for volcengine", () => {
    const model = getDefaultModelForProvider("volcengine");
    expect(model).toBeDefined();
    expect(model!.provider).toBe("volcengine");
    expect(model!.modelId).toBe(PROVIDERS.volcengine.extraModels![0].modelId);
  });

  it("should return undefined for providers with no models", () => {
    initKnownModels({}); // empty catalog — only extraModels

    for (const provider of ALL_PROVIDERS) {
      const model = getDefaultModelForProvider(provider);
      if (getProviderMeta(provider)?.extraModels) {
        // extraModels providers should return real model data
        expect(model).toBeDefined();
        expect(model!.modelId).not.toBe(provider);
      } else {
        // Providers with no models should return undefined
        expect(model).toBeUndefined();
      }
    }
  });
});

describe("getModelsForProvider", () => {
  beforeEach(() => {
    initKnownModels({
      openai: [
        { id: "gpt-4o", name: "GPT-4o" },
        { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      ],
    });
  });

  it("should return all models for provider", () => {
    const models = getModelsForProvider("openai");
    expect(models).toHaveLength(2);
    expect(models[0].modelId).toBe("gpt-4o");
  });

  it("should return extraModels for volcengine", () => {
    const models = getModelsForProvider("volcengine");
    expect(models).toEqual(PROVIDERS.volcengine.extraModels);
  });

  it("should return empty array for providers with no models", () => {
    initKnownModels({}); // empty catalog — only EXTRA_MODELS

    // Providers without EXTRA_MODELS should return empty array
    const models = getModelsForProvider("openai");
    expect(models).toEqual([]);
  });

  it("should return extraModels even with empty catalog", () => {
    initKnownModels({}); // empty catalog

    for (const provider of ALL_PROVIDERS) {
      const expectedModels = getProviderMeta(provider)?.extraModels;
      if (!expectedModels) continue;
      const models = getModelsForProvider(provider);
      expect(models.length).toBe(expectedModels.length);
      for (const model of models) {
        expect(model.modelId).not.toBe(provider);
      }
    }
  });
});

describe("resolveModelConfig", () => {
  beforeEach(() => {
    initKnownModels({
      openai: [{ id: "gpt-4o", name: "GPT-4o" }],
      anthropic: [{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" }],
      deepseek: [{ id: "deepseek-chat", name: "DeepSeek Chat" }],
    });
  });

  it("should return region default when no overrides", () => {
    const model = resolveModelConfig({ region: "cn" });
    expect(model.provider).toBe("deepseek");
    expect(model.modelId).toBe("deepseek-chat");
  });

  it("should use user provider and model when both specified", () => {
    const model = resolveModelConfig({
      region: "us",
      userProvider: "anthropic",
      userModelId: "claude-sonnet-4-20250514",
    });
    expect(model.provider).toBe("anthropic");
    expect(model.modelId).toBe("claude-sonnet-4-20250514");
  });

  it("should use default model for user provider when no model specified", () => {
    const model = resolveModelConfig({
      region: "us",
      userProvider: "deepseek",
    });
    expect(model.provider).toBe("deepseek");
    expect(model.modelId).toBe("deepseek-chat");
  });

  it("should ignore region when user specifies full override", () => {
    const model = resolveModelConfig({
      region: "cn",
      userProvider: "openai",
      userModelId: "gpt-4o-mini",
    });
    expect(model.provider).toBe("openai");
    expect(model.modelId).toBe("gpt-4o-mini");
  });
});

describe("getProvidersForRegion", () => {
  it("should list CN providers with domestic first", () => {
    const providers = getProvidersForRegion("cn");
    expect(providers[0]).toBe("deepseek");
    expect(providers).toContain("zhipu");
    expect(providers).toContain("kimi");
    expect(providers).toContain("moonshot-coding");
    expect(providers).toContain("qwen");
    expect(providers).toContain("volcengine");
  });

  it("should list US providers with OpenAI first", () => {
    const providers = getProvidersForRegion("us");
    expect(providers[0]).toBe("openai");
    expect(providers).toContain("anthropic");
    expect(providers).toContain("google");
    expect(providers).toContain("moonshot");
    expect(providers).toContain("zai");
  });

  it("should return default list for unknown region", () => {
    const providers = getProvidersForRegion("jp");
    expect(providers[0]).toBe("openai");
  });
});

describe("resolveGatewayProvider", () => {
  it("should return root providers as-is", () => {
    expect(resolveGatewayProvider("anthropic")).toBe("anthropic");
    expect(resolveGatewayProvider("google")).toBe("google");
    expect(resolveGatewayProvider("openai")).toBe("openai");
  });

  it("should map subscription plans without extraModels to parent", () => {
    expect(resolveGatewayProvider("claude")).toBe("anthropic");
    expect(resolveGatewayProvider("gemini")).toBe("google");
  });

  it("should keep subscription plans with extraModels as-is", () => {
    expect(resolveGatewayProvider("zhipu-coding")).toBe("zhipu-coding");
    expect(resolveGatewayProvider("moonshot-coding")).toBe("moonshot-coding");
  });
});

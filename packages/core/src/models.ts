/** Supported LLM providers (cloud API services requiring API keys). */
export type LLMProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "zhipu"
  | "zai"
  | "moonshot"
  | "qwen"
  | "groq"
  | "mistral"
  | "xai"
  | "openrouter"
  | "minimax"
  | "venice"
  | "xiaomi"
  | "volcengine"
  | "amazon-bedrock";

/** Display names for all providers. */
export const PROVIDER_LABELS: Record<LLMProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google (Gemini)",
  deepseek: "DeepSeek",
  zhipu: "Zhipu (GLM)",
  zai: "Z.ai (GLM)",
  moonshot: "Moonshot (Kimi)",
  qwen: "Qwen",
  groq: "Groq",
  mistral: "Mistral",
  xai: "xAI (Grok)",
  openrouter: "OpenRouter",
  minimax: "MiniMax",
  venice: "Venice AI",
  xiaomi: "Xiaomi",
  volcengine: "Volcengine (Doubao)",
  "amazon-bedrock": "Amazon Bedrock",
};

/** Ordered list of all providers. */
export const ALL_PROVIDERS: LLMProvider[] = Object.keys(
  PROVIDER_LABELS,
) as LLMProvider[];

/**
 * OpenAI-compatible API base URLs for each provider.
 * Most providers expose a /chat/completions endpoint compatible with the OpenAI format.
 */
export const PROVIDER_BASE_URLS: Record<LLMProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  deepseek: "https://api.deepseek.com/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  zai: "https://api.z.ai/api/paas/v4",
  moonshot: "https://api.moonshot.cn/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  minimax: "https://api.minimax.chat/v1",
  venice: "https://api.venice.ai/api/v1",
  xiaomi: "https://api.xiaomi.com/v1",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  "amazon-bedrock": "https://bedrock-runtime.us-east-1.amazonaws.com",
};

/** Pricing / official page URLs for each provider. */
export const PROVIDER_URLS: Record<LLMProvider, string> = {
  openai: "https://openai.com/api/pricing/",
  anthropic: "https://www.anthropic.com/pricing",
  google: "https://ai.google.dev/pricing",
  deepseek: "https://platform.deepseek.com/api-docs/pricing",
  zhipu: "https://open.bigmodel.cn/pricing",
  zai: "https://z.ai/pricing",
  moonshot: "https://platform.moonshot.cn/docs/pricing",
  qwen: "https://help.aliyun.com/zh/model-studio/getting-started/models",
  groq: "https://groq.com/pricing/",
  mistral: "https://mistral.ai/products#pricing",
  xai: "https://docs.x.ai/docs/models#models-and-pricing",
  openrouter: "https://openrouter.ai/models",
  minimax: "https://platform.minimaxi.com/document/Price",
  venice: "https://venice.ai/pricing",
  xiaomi: "https://developers.xiaomi.com/mimo",
  volcengine: "https://www.volcengine.com/docs/82379/1330310",
  "amazon-bedrock": "https://aws.amazon.com/bedrock/pricing/",
};

/**
 * Maps each provider to its well-known environment variable name.
 * Used by the secret injector to pass API keys to the gateway process.
 */
export const PROVIDER_ENV_VARS: Record<LLMProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY", // OpenClaw expects GEMINI_API_KEY for google provider
  deepseek: "DEEPSEEK_API_KEY",
  zhipu: "ZHIPU_API_KEY",
  zai: "ZAI_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  qwen: "DASHSCOPE_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  minimax: "MINIMAX_API_KEY",
  venice: "VENICE_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  volcengine: "ARK_API_KEY",
  "amazon-bedrock": "AWS_ACCESS_KEY_ID",
};

/**
 * Maps each provider to the settings key used to store its API key.
 * e.g. "openai" -> "openai-api-key"
 */
export function providerSecretKey(provider: LLMProvider): string {
  return `${provider}-api-key`;
}

/** A model configuration with provider and model ID. */
export interface ModelConfig {
  provider: LLMProvider;
  modelId: string;
  displayName: string;
}

/** Known regions. */
export type Region = "us" | "eu" | "cn" | (string & {});

/**
 * Extra models for providers not supported by OpenClaw.
 * These are our own additions that won't appear in OpenClaw's models.json.
 */
export const EXTRA_MODELS: Partial<Record<LLMProvider, ModelConfig[]>> = {
  volcengine: [
    {
      provider: "volcengine",
      modelId: "doubao-seed-1-8-251228",
      displayName: "Doubao Seed 1.8",
    },
    {
      provider: "volcengine",
      modelId: "doubao-seed-1-6-251015",
      displayName: "Doubao Seed 1.6",
    },
    {
      provider: "volcengine",
      modelId: "doubao-seed-1-6-lite-251015",
      displayName: "Doubao Seed 1.6 Lite",
    },
    {
      provider: "volcengine",
      modelId: "doubao-seed-1-6-flash-250828",
      displayName: "Doubao Seed 1.6 Flash",
    },
  ],
  zhipu: [
    { provider: "zhipu", modelId: "glm-4.7", displayName: "GLM-4.7" },
    {
      provider: "zhipu",
      modelId: "glm-4.7-flash",
      displayName: "GLM-4.7-Flash",
    },
    { provider: "zhipu", modelId: "glm-4.6", displayName: "GLM-4.6" },
    { provider: "zhipu", modelId: "glm-4.6v", displayName: "GLM-4.6V" },
    { provider: "zhipu", modelId: "glm-4.5", displayName: "GLM-4.5" },
    {
      provider: "zhipu",
      modelId: "glm-4.5-flash",
      displayName: "GLM-4.5-Flash",
    },
    { provider: "zhipu", modelId: "glm-4.5-air", displayName: "GLM-4.5-Air" },
    { provider: "zhipu", modelId: "glm-4.5v", displayName: "GLM-4.5V" },
  ],
};

/**
 * All known models grouped by provider.
 *
 * At startup this only contains EXTRA_MODELS. Once the gateway's models.json
 * is loaded, `initKnownModels()` populates it with OpenClaw's full catalog.
 */
// eslint-disable-next-line import/no-mutable-exports
export let KNOWN_MODELS: Partial<Record<LLMProvider, ModelConfig[]>> = {
  ...EXTRA_MODELS,
};

/**
 * Populate KNOWN_MODELS from the gateway's model catalog.
 *
 * Called by `readFullModelCatalog()` in @easyclaw/gateway after reading
 * models.json. EXTRA_MODELS providers take precedence (our own config).
 */
export function initKnownModels(
  catalog: Record<string, Array<{ id: string; name: string }>>,
): void {
  const result: Partial<Record<LLMProvider, ModelConfig[]>> = {};

  for (const [provider, entries] of Object.entries(catalog)) {
    if (!ALL_PROVIDERS.includes(provider as LLMProvider)) continue;
    const p = provider as LLMProvider;
    result[p] = entries.map((e) => ({
      provider: p,
      modelId: e.id,
      displayName: e.name,
    }));
  }

  // EXTRA_MODELS take precedence
  for (const [provider, models] of Object.entries(EXTRA_MODELS)) {
    if (models && models.length > 0) {
      result[provider as LLMProvider] = models;
    }
  }

  KNOWN_MODELS = result;
}

/** Default model configurations per region. */
const REGION_DEFAULTS: Record<string, ModelConfig> = {
  us: { provider: "openai", modelId: "gpt-4o", displayName: "GPT-4o" },
  eu: { provider: "openai", modelId: "gpt-4o", displayName: "GPT-4o" },
  cn: {
    provider: "deepseek",
    modelId: "deepseek-chat",
    displayName: "DeepSeek Chat",
  },
};

/** Global fallback if region not found in defaults. */
const GLOBAL_DEFAULT: ModelConfig = {
  provider: "openai",
  modelId: "gpt-4o",
  displayName: "GPT-4o",
};

/**
 * Get the default model config for a given region.
 */
export function getDefaultModelForRegion(region: string): ModelConfig {
  return REGION_DEFAULTS[region] ?? GLOBAL_DEFAULT;
}

/**
 * Get the default model for a specific provider.
 * Returns the first model in that provider's list, or undefined if none are known.
 */
export function getDefaultModelForProvider(
  provider: LLMProvider,
): ModelConfig | undefined {
  const models = KNOWN_MODELS[provider];
  if (models && models.length > 0) {
    return models[0];
  }
  return undefined;
}

/**
 * Get all known models for a specific provider.
 * Returns the provider's model list, or an empty array if none are known.
 */
export function getModelsForProvider(provider: LLMProvider): ModelConfig[] {
  return KNOWN_MODELS[provider] ?? [];
}

/**
 * Resolve the effective model config.
 * If the user has overridden the provider/model, use that.
 * Otherwise, use the region default.
 */
export function resolveModelConfig(options: {
  region: string;
  userProvider?: LLMProvider;
  userModelId?: string;
}): ModelConfig {
  const regionDefault = getDefaultModelForRegion(options.region);

  if (options.userProvider && options.userModelId) {
    return {
      provider: options.userProvider,
      modelId: options.userModelId,
      displayName: options.userModelId,
    };
  }

  if (options.userProvider) {
    return getDefaultModelForProvider(options.userProvider) ?? regionDefault;
  }

  return regionDefault;
}

/**
 * Get available providers for a region (ordered by recommendation).
 * China region lists domestic providers first for better accessibility.
 */
export function getProvidersForRegion(region: string): LLMProvider[] {
  if (region === "cn") {
    return [
      "deepseek",
      "zhipu",
      "moonshot",
      "qwen",
      "volcengine",
      "minimax",
      "xiaomi",
      "openai",
      "anthropic",
      "google",
    ];
  }
  return [
    "openai",
    "anthropic",
    "google",
    "deepseek",
    "zai",
    "groq",
    "mistral",
    "xai",
    "openrouter",
  ];
}

/** Supported LLM providers (cloud API services requiring API keys). */
export type LLMProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "zhipu"
  | "moonshot"
  | "qwen"
  | "groq"
  | "mistral"
  | "xai"
  | "openrouter"
  | "minimax"
  | "venice"
  | "xiaomi"
  | "amazon-bedrock";

/** Display names for all providers. */
export const PROVIDER_LABELS: Record<LLMProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google (Gemini)",
  deepseek: "DeepSeek",
  zhipu: "Zhipu (GLM)",
  moonshot: "Moonshot (Kimi)",
  qwen: "Qwen",
  groq: "Groq",
  mistral: "Mistral",
  xai: "xAI (Grok)",
  openrouter: "OpenRouter",
  minimax: "MiniMax",
  venice: "Venice AI",
  xiaomi: "Xiaomi",
  "amazon-bedrock": "Amazon Bedrock",
};

/** Ordered list of all providers. */
export const ALL_PROVIDERS: LLMProvider[] = Object.keys(PROVIDER_LABELS) as LLMProvider[];

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
  moonshot: "https://api.moonshot.cn/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  minimax: "https://api.minimax.chat/v1",
  venice: "https://api.venice.ai/api/v1",
  xiaomi: "https://api.xiaomi.com/v1",
  "amazon-bedrock": "https://bedrock-runtime.us-east-1.amazonaws.com",
};

/** Pricing / official page URLs for each provider. */
export const PROVIDER_URLS: Record<LLMProvider, string> = {
  openai: "https://openai.com/api/pricing/",
  anthropic: "https://www.anthropic.com/pricing",
  google: "https://ai.google.dev/pricing",
  deepseek: "https://platform.deepseek.com/api-docs/pricing",
  zhipu: "https://open.bigmodel.cn/pricing",
  moonshot: "https://platform.moonshot.cn/docs/pricing",
  qwen: "https://help.aliyun.com/zh/model-studio/getting-started/models",
  groq: "https://groq.com/pricing/",
  mistral: "https://mistral.ai/products#pricing",
  xai: "https://docs.x.ai/docs/models#models-and-pricing",
  openrouter: "https://openrouter.ai/models",
  minimax: "https://platform.minimaxi.com/document/Price",
  venice: "https://venice.ai/pricing",
  xiaomi: "https://developers.xiaomi.com/mimo",
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
  moonshot: "MOONSHOT_API_KEY",
  qwen: "DASHSCOPE_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  minimax: "MINIMAX_API_KEY",
  venice: "VENICE_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
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

/** All known models grouped by provider (subset with well-known defaults). */
export const KNOWN_MODELS: Partial<Record<LLMProvider, ModelConfig[]>> = {
  openai: [
    { provider: "openai", modelId: "gpt-4o", displayName: "GPT-4o" },
    { provider: "openai", modelId: "gpt-4o-mini", displayName: "GPT-4o Mini" },
  ],
  anthropic: [
    { provider: "anthropic", modelId: "claude-sonnet-4-20250514", displayName: "Claude Sonnet 4" },
    { provider: "anthropic", modelId: "claude-haiku-3-5-20241022", displayName: "Claude 3.5 Haiku" },
  ],
  google: [
    { provider: "google", modelId: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
    { provider: "google", modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
  ],
  deepseek: [
    { provider: "deepseek", modelId: "deepseek-chat", displayName: "DeepSeek Chat" },
    { provider: "deepseek", modelId: "deepseek-reasoner", displayName: "DeepSeek Reasoner" },
  ],
  zhipu: [
    { provider: "zhipu", modelId: "glm-4-plus", displayName: "GLM-4 Plus" },
    { provider: "zhipu", modelId: "glm-4-flash", displayName: "GLM-4 Flash" },
  ],
  moonshot: [
    { provider: "moonshot", modelId: "kimi-k2.5", displayName: "Kimi K2.5" },
  ],
  qwen: [
    { provider: "qwen", modelId: "qwen-plus", displayName: "Qwen Plus" },
    { provider: "qwen", modelId: "qwen-turbo", displayName: "Qwen Turbo" },
  ],
  groq: [
    { provider: "groq", modelId: "llama-3.3-70b-versatile", displayName: "Llama 3.3 70B" },
  ],
  mistral: [
    { provider: "mistral", modelId: "mistral-large-latest", displayName: "Mistral Large" },
  ],
  xai: [
    { provider: "xai", modelId: "grok-3", displayName: "Grok 3" },
  ],
  minimax: [
    { provider: "minimax", modelId: "MiniMax-M2.1", displayName: "MiniMax M2.1" },
  ],
  xiaomi: [
    { provider: "xiaomi", modelId: "mimo-v2-flash", displayName: "MiMo v2 Flash" },
  ],
};

/** Default model configurations per region. */
const REGION_DEFAULTS: Record<string, ModelConfig> = {
  us: { provider: "openai", modelId: "gpt-4o", displayName: "GPT-4o" },
  eu: { provider: "openai", modelId: "gpt-4o", displayName: "GPT-4o" },
  cn: { provider: "deepseek", modelId: "deepseek-chat", displayName: "DeepSeek Chat" },
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
 * Returns the first model in that provider's list.
 */
export function getDefaultModelForProvider(provider: LLMProvider): ModelConfig {
  const models = KNOWN_MODELS[provider];
  if (models && models.length > 0) {
    return models[0];
  }
  return { provider, modelId: provider, displayName: PROVIDER_LABELS[provider] ?? provider };
}

/**
 * Get all known models for a specific provider.
 * Returns the provider's model list, or a single default model if none are defined.
 */
export function getModelsForProvider(provider: LLMProvider): ModelConfig[] {
  return KNOWN_MODELS[provider] ?? [getDefaultModelForProvider(provider)];
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
    return getDefaultModelForProvider(options.userProvider);
  }

  return regionDefault;
}

/**
 * Get available providers for a region (ordered by recommendation).
 * China region lists domestic providers first for better accessibility.
 */
export function getProvidersForRegion(region: string): LLMProvider[] {
  if (region === "cn") {
    return ["deepseek", "zhipu", "moonshot", "qwen", "minimax", "xiaomi", "openai", "anthropic", "google"];
  }
  return ["openai", "anthropic", "google", "deepseek", "groq", "mistral", "xai", "openrouter"];
}

import { DEFAULTS } from "../defaults.js";

/** Supported LLM providers (cloud APIs, subscriptions, and local servers). */
export type LLMProvider =
  | "openai"
  | "openai-codex"
  | "anthropic"
  | "google"
  | "deepseek"
  | "zhipu"
  | "zhipu-coding"
  | "zai"
  | "moonshot"
  | "kimi"
  | "moonshot-coding"
  | "qwen"
  | "qwen-coding"
  | "modelscope"
  | "groq"
  | "mistral"
  | "xai"
  | "openrouter"
  | "minimax"
  | "minimax-cn"
  | "minimax-coding"
  | "venice"
  | "xiaomi"
  | "volcengine"
  | "volcengine-coding"
  | "amazon-bedrock"
  | "nvidia"
  | "nvidia-nim"
  | "gemini"
  | "claude"
  | "ollama";

/** Root provider IDs (excludes subscription plan IDs). */
export type RootProvider = Exclude<LLMProvider, "openai-codex" | "zhipu-coding" | "moonshot-coding" | "minimax-coding" | "volcengine-coding" | "qwen-coding" | "modelscope" | "nvidia-nim" | "gemini" | "claude">;

/** Per-million-token cost in USD for OpenClaw usage tracking. */
export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** A model configuration with provider and model ID. */
export interface ModelConfig {
  provider: LLMProvider;
  modelId: string;
  displayName: string;
  /** Cost in USD per million tokens. Converted from CNY at ~7.0 CNY/USD where applicable. */
  cost?: ModelCost;
  /** Whether this model supports image/vision input. Defaults to false for extra models. */
  supportsVision?: boolean;
  /** Context window size in tokens. Used by config-writer; falls back to 128000 if omitted. */
  contextWindow?: number;
  /** Effective context budget when runtime caps usable context below the raw window. */
  contextTokens?: number;
}

/** A subscription plan nested under a root provider. */
export interface SubscriptionPlan {
  /** Flat provider ID used in DB and secrets (e.g. "zhipu-coding"). */
  id: LLMProvider;
  /** Display name (e.g. "Zhipu Coding Plan"). */
  label: string;
  /** OpenAI-compatible API base URL (may differ from parent). */
  baseUrl: string;
  /** URL where users can subscribe. */
  subscriptionUrl: string;
  /** URL where users create/manage API keys for this plan. */
  apiKeyUrl: string;
  /** Well-known environment variable name for the API key. */
  envVar: string;
  /** Whether this plan uses OAuth instead of API keys. */
  oauth?: boolean;
  /** Vendor catalog provider to inherit models from (instead of parent).
   *  e.g. "google-gemini-cli" for Gemini OAuth which uses Cloud Code Assist API. */
  catalogProvider?: string;
  /** Extra models specific to this plan. */
  extraModels?: ModelConfig[];
  /** Fallback models used locally until upstream catalog catches up. */
  fallbackModels?: ModelConfig[];
  /** Preferred default model ID for this plan, or "latest" to use the first catalog model. */
  preferredModel?: string;
  /** API format used by this plan's endpoint (defaults to "openai-completions"). */
  api?: string;
  /** Lightweight model ID for API-key validation when local models / catalog aren't loaded yet. */
  validationModel?: string;
}

/** Unified metadata for a root LLM provider. */
export interface ProviderMeta {
  /** Display name (e.g. "OpenAI"). */
  label: string;
  /** OpenAI-compatible API base URL. */
  baseUrl: string;
  /** Pricing / official page URL. */
  url: string;
  /** URL where users can create / manage API keys. */
  apiKeyUrl: string;
  /** Well-known environment variable name for the API key. */
  envVar: string;
  /**
   * Optional subscription URL shown as an informational link in the API tab
   * (e.g. zai links to zhipu-coding subscription page).
   * For providers with their own subscription offering, use `subscriptionPlans` instead.
   */
  subscriptionUrl?: string;
  /**
   * Extra models not supported by OpenClaw.
   * These are our own additions that won't appear in OpenClaw's models.json.
   */
  extraModels?: ModelConfig[];
  /** Fallback models used locally until upstream catalog catches up. */
  fallbackModels?: ModelConfig[];
  /** Preferred default model ID for this provider, or "latest" to use the first catalog model. */
  preferredModel?: string;
  /** API format used by this provider's endpoint (defaults to "openai-completions"). */
  api?: string;
  /** Lightweight model ID for API-key validation when local models / catalog aren't loaded yet. */
  validationModel?: string;
  /** Subscription plans that are logically children of this provider. */
  subscriptionPlans?: SubscriptionPlan[];
}

/** Resolved metadata for any provider ID (root or subscription plan). */
export interface ResolvedProviderMeta {
  label: string;
  baseUrl: string;
  url: string;
  apiKeyUrl: string;
  envVar: string;
  subscriptionUrl?: string;
  oauth?: boolean;
  catalogProvider?: string;
  extraModels?: ModelConfig[];
  fallbackModels?: ModelConfig[];
  preferredModel?: string;
  /** API format used by this provider's endpoint (defaults to "openai-completions"). */
  api?: string;
  /** Lightweight model ID for API-key validation when fallbackModels / catalog aren't loaded yet. */
  validationModel?: string;
}

// CNY → USD conversion rate used for cost estimates below.
export const CNY_USD = DEFAULTS.currency.cnyUsd;
const cny = (yuan: number) => Math.round((yuan / CNY_USD) * 100) / 100;
const FREE_COST: ModelCost = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

/**
 * Unified provider registry. All provider metadata lives here.
 * Subscription plans are nested under their parent provider.
 */
export const PROVIDERS: Record<RootProvider, ProviderMeta> = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    url: "https://openai.com/api/pricing/",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    envVar: "OPENAI_API_KEY",
    subscriptionPlans: [
      {
        id: "openai-codex",
        label: "OpenAI Codex (Subscription)",
        baseUrl: "https://api.openai.com/v1",
        subscriptionUrl: "https://chatgpt.com/#pricing",
        apiKeyUrl: "https://platform.openai.com/api-keys",
        envVar: "OPENAI_CODEX_API_KEY",
        oauth: true,
        catalogProvider: "openai-codex",
        api: "openai-codex-responses",
        validationModel: "gpt-5.2-codex",
        preferredModel: "latest",
        fallbackModels: [
          { provider: "openai-codex", modelId: "gpt-5.2-codex", displayName: "GPT-5.2 Codex", contextWindow: 200000 },
          { provider: "openai-codex", modelId: "gpt-5-codex", displayName: "GPT-5 Codex", contextWindow: 200000 },
          { provider: "openai-codex", modelId: "gpt-5.1-codex", displayName: "GPT-5.1 Codex", contextWindow: 200000 },
          { provider: "openai-codex", modelId: "gpt-5.1-codex-max", displayName: "GPT-5.1 Codex Max", contextWindow: 200000 },
          { provider: "openai-codex", modelId: "gpt-5.1-codex-mini", displayName: "GPT-5.1 Codex Mini", contextWindow: 200000 },
        ],
      },
    ],
  },
  anthropic: {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    url: "https://www.anthropic.com/pricing",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    envVar: "ANTHROPIC_API_KEY",
    api: "anthropic-messages",
    validationModel: "claude-haiku-4-5-20251001",
    subscriptionPlans: [
      {
        id: "claude",
        label: "Claude (Subscription)",
        baseUrl: "https://api.anthropic.com/v1",
        subscriptionUrl: "https://claude.ai/upgrade",
        apiKeyUrl: "https://console.anthropic.com/settings/keys",
        envVar: "ANTHROPIC_API_KEY",
      },
    ],
  },
  google: {
    label: "Google (Gemini)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    url: "https://ai.google.dev/pricing",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    envVar: "GEMINI_API_KEY",
    subscriptionPlans: [
      {
        id: "gemini",
        label: "Google Gemini (Subscription)",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        subscriptionUrl: "https://gemini.google/subscriptions/",
        apiKeyUrl: "https://aistudio.google.com/app/apikey",
        envVar: "GOOGLE_GEMINI_CLI_API_KEY",
        oauth: true,
        catalogProvider: "google-gemini-cli",
      },
    ],
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    url: "https://platform.deepseek.com/api-docs/pricing",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    envVar: "DEEPSEEK_API_KEY",
    preferredModel: "deepseek-chat",
    extraModels: [
      { provider: "deepseek", modelId: "deepseek-chat", displayName: "DeepSeek Chat (V3)", contextWindow: 128000 },
      { provider: "deepseek", modelId: "deepseek-reasoner", displayName: "DeepSeek Reasoner (R1)", contextWindow: 128000 },
    ],
  },
  zhipu: {
    label: "Zhipu (GLM)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    url: "https://open.bigmodel.cn/pricing",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    envVar: "ZHIPU_API_KEY",
    extraModels: [
      {
        provider: "zhipu",
        modelId: "glm-5",
        displayName: "GLM-5",
        cost: { input: cny(4), output: cny(18), cacheRead: 0, cacheWrite: 0 },
        contextWindow: 202752,
      },
      {
        provider: "zhipu",
        modelId: "glm-5-code",
        displayName: "GLM-5-Code",
        cost: { input: cny(6), output: cny(28), cacheRead: 0, cacheWrite: 0 },
        contextWindow: 202752,
      },
      {
        provider: "zhipu",
        modelId: "glm-4.7-flash",
        displayName: "GLM-4.7-Flash",
        cost: FREE_COST,
        contextWindow: 204800,
      },
      {
        provider: "zhipu",
        modelId: "glm-4.7",
        displayName: "GLM-4.7",
        cost: { input: cny(4), output: cny(16), cacheRead: 0, cacheWrite: 0 },
        contextWindow: 204800,
      },
      {
        provider: "zhipu",
        modelId: "glm-4.6",
        displayName: "GLM-4.6",
        cost: { input: cny(4), output: cny(16), cacheRead: 0, cacheWrite: 0 },
        contextWindow: 198000,
      },
      {
        provider: "zhipu",
        modelId: "glm-4.6v",
        displayName: "GLM-4.6V",
        cost: { input: cny(2), output: cny(6), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
        contextWindow: 198000,
      },
      {
        provider: "zhipu",
        modelId: "glm-4.5",
        displayName: "GLM-4.5",
        cost: { input: cny(4), output: cny(16), cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
      },
      {
        provider: "zhipu",
        modelId: "glm-4.5-flash",
        displayName: "GLM-4.5-Flash",
        cost: FREE_COST,
        contextWindow: 128000,
      },
      {
        provider: "zhipu",
        modelId: "glm-4.5-air",
        displayName: "GLM-4.5-Air",
        cost: { input: cny(1), output: cny(8), cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
      },
      {
        provider: "zhipu",
        modelId: "glm-4.5v",
        displayName: "GLM-4.5V",
        cost: { input: cny(4), output: cny(12), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
        contextWindow: 128000,
      },
      {
        provider: "zhipu",
        modelId: "glm-4-plus",
        displayName: "GLM-4 Plus",
        cost: { input: cny(5), output: cny(5), cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
      },
      {
        provider: "zhipu",
        modelId: "glm-4-flash",
        displayName: "GLM-4 Flash",
        cost: FREE_COST,
        contextWindow: 128000,
      },
    ],
    subscriptionPlans: [
      {
        id: "zhipu-coding",
        label: "Zhipu Coding Plan (GLM)",
        baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
        subscriptionUrl: "https://www.bigmodel.cn/glm-coding?ic=QWUW9KBBBL",
        apiKeyUrl: "https://www.bigmodel.cn/usercenter/proj-mgmt/apikeys",
        envVar: "ZHIPU_CODING_API_KEY",
        extraModels: [
          {
            provider: "zhipu-coding",
            modelId: "glm-5",
            displayName: "GLM-5",
            cost: { input: cny(4), output: cny(18), cacheRead: 0, cacheWrite: 0 },
            contextWindow: 202752,
          },
          {
            provider: "zhipu-coding",
            modelId: "glm-4.7",
            displayName: "GLM-4.7",
            cost: { input: cny(4), output: cny(16), cacheRead: 0, cacheWrite: 0 },
            contextWindow: 204800,
          },
          {
            provider: "zhipu-coding",
            modelId: "glm-4.5-air",
            displayName: "GLM-4.5-Air",
            cost: { input: cny(1), output: cny(8), cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
          },
        ],
      },
    ],
  },
  zai: {
    label: "Z.ai (GLM)",
    baseUrl: "https://api.z.ai/api/paas/v4",
    url: "https://docs.z.ai/guides/overview/pricing",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    envVar: "ZAI_API_KEY",
    subscriptionUrl: "https://www.bigmodel.cn/glm-coding?ic=QWUW9KBBBL",
    preferredModel: "glm-4.7-flash",
  },
  moonshot: {
    label: "Moonshot (Kimi)",
    baseUrl: "https://api.moonshot.ai/v1",
    url: "https://platform.moonshot.ai/docs/pricing/chat",
    apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    envVar: "MOONSHOT_API_KEY",
    preferredModel: "kimi-k2.5",
    extraModels: [
      {
        provider: "moonshot",
        modelId: "kimi-k2.5",
        displayName: "Kimi K2.5",
        supportsVision: true,
        contextWindow: 262144,
      },
      {
        provider: "moonshot",
        modelId: "kimi-k2-thinking",
        displayName: "Kimi K2 Thinking",
        contextWindow: 262144,
      },
      {
        provider: "moonshot",
        modelId: "kimi-k2-0905-preview",
        displayName: "Kimi K2",
        contextWindow: 262144,
      },
    ],
  },
  kimi: {
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    url: "https://platform.moonshot.cn/docs/pricing/chat",
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    envVar: "KIMI_API_KEY",
    extraModels: [
      {
        provider: "kimi",
        modelId: "kimi-k2.5",
        displayName: "Kimi K2.5",
        supportsVision: true,
        contextWindow: 262144,
      },
      {
        provider: "kimi",
        modelId: "kimi-k2-thinking",
        displayName: "Kimi K2 Thinking",
        contextWindow: 262144,
      },
      {
        provider: "kimi",
        modelId: "kimi-k2-0905-preview",
        displayName: "Kimi K2",
        contextWindow: 262144,
      },
      {
        provider: "kimi",
        modelId: "moonshot-v1-128k",
        displayName: "Moonshot V1 128K",
        contextWindow: 128000,
      },
      {
        provider: "kimi",
        modelId: "moonshot-v1-32k",
        displayName: "Moonshot V1 32K",
        contextWindow: 32000,
      },
      {
        provider: "kimi",
        modelId: "moonshot-v1-8k",
        displayName: "Moonshot V1 8K",
        contextWindow: 8000,
      },
    ],
    subscriptionPlans: [
      {
        id: "moonshot-coding",
        label: "Kimi Code",
        baseUrl: "https://api.kimi.com/coding",
        subscriptionUrl: "https://www.kimi.com/code",
        apiKeyUrl: "https://www.kimi.com/code/docs/",
        envVar: "KIMI_CODE_API_KEY",
        api: "anthropic-messages",
        extraModels: [
          {
            provider: "moonshot-coding",
            modelId: "kimi-for-coding",
            displayName: "Kimi for Coding",
            contextWindow: 262144,
          },
        ],
      },
    ],
  },
  qwen: {
    label: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    url: "https://help.aliyun.com/zh/model-studio/getting-started/models",
    apiKeyUrl: "https://bailian.console.aliyun.com/#/model-market/api-key",
    envVar: "DASHSCOPE_API_KEY",
    preferredModel: "qwen-plus",
    extraModels: [
      { provider: "qwen", modelId: "qwen-max", displayName: "Qwen Max", contextWindow: 32768 },
      { provider: "qwen", modelId: "qwen-plus", displayName: "Qwen Plus", contextWindow: 131072 },
      { provider: "qwen", modelId: "qwen-turbo", displayName: "Qwen Turbo", contextWindow: 131072 },
      { provider: "qwen", modelId: "qwen-long", displayName: "Qwen Long", contextWindow: 10000000 },
      { provider: "qwen", modelId: "qwen3-235b-a22b", displayName: "Qwen3 235B", contextWindow: 256000 },
      { provider: "qwen", modelId: "qwen3-30b-a3b", displayName: "Qwen3 30B", contextWindow: 256000 },
      { provider: "qwen", modelId: "qwen3-coder-plus", displayName: "Qwen3 Coder Plus", contextWindow: 131072 },
      { provider: "qwen", modelId: "qwq-plus", displayName: "QwQ Plus", contextWindow: 131072 },
    ],
    subscriptionPlans: [
      {
        id: "qwen-coding",
        label: "Qwen Coding Plan (百炼)",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        subscriptionUrl: "https://www.aliyun.com/benefit/scene/codingplan",
        apiKeyUrl: "https://bailian.console.aliyun.com/cn-beijing/?tab=model#/efm/coding_plan",
        envVar: "DASHSCOPE_CODING_API_KEY",
        extraModels: [
          { provider: "qwen-coding", modelId: "qwen3.5-plus", displayName: "Qwen3.5 Plus", supportsVision: true, contextWindow: 131072 },
          { provider: "qwen-coding", modelId: "qwen3-max-2026-01-23", displayName: "Qwen3 Max", contextWindow: 32768 },
          { provider: "qwen-coding", modelId: "qwen3-coder-next", displayName: "Qwen3 Coder Next", contextWindow: 131072 },
          { provider: "qwen-coding", modelId: "qwen3-coder-plus", displayName: "Qwen3 Coder Plus", contextWindow: 131072 },
          { provider: "qwen-coding", modelId: "MiniMax-M2.5", displayName: "MiniMax M2.5", contextWindow: 192000 },
          { provider: "qwen-coding", modelId: "glm-5", displayName: "GLM-5", contextWindow: 202752 },
          { provider: "qwen-coding", modelId: "glm-4.7", displayName: "GLM-4.7", contextWindow: 204800 },
          { provider: "qwen-coding", modelId: "kimi-k2.5", displayName: "Kimi K2.5", supportsVision: true, contextWindow: 262144 },
        ],
      },
      {
        id: "modelscope",
        label: "ModelScope (魔搭)",
        baseUrl: "https://api-inference.modelscope.cn/v1",
        subscriptionUrl: "https://modelscope.cn/docs/model-service/API-Inference/intro",
        apiKeyUrl: "https://modelscope.cn/my/myaccesstoken",
        envVar: "MODELSCOPE_API_KEY",
        extraModels: [
          { provider: "modelscope", modelId: "Qwen/Qwen3.5-397B-A17B", displayName: "Qwen3.5 397B", contextWindow: 131072 },
          { provider: "modelscope", modelId: "Qwen/Qwen3-235B-A22B-Instruct-2507", displayName: "Qwen3 235B Instruct", contextWindow: 256000 },
          { provider: "modelscope", modelId: "Qwen/Qwen3-235B-A22B-Thinking-2507", displayName: "Qwen3 235B Thinking", contextWindow: 256000 },
          { provider: "modelscope", modelId: "Qwen/Qwen3-Coder-480B-A35B-Instruct", displayName: "Qwen3 Coder 480B", contextWindow: 256000 },
          { provider: "modelscope", modelId: "Qwen/Qwen3-Coder-30B-A3B-Instruct", displayName: "Qwen3 Coder 30B", contextWindow: 256000 },
          { provider: "modelscope", modelId: "Qwen/Qwen3-32B", displayName: "Qwen3 32B", contextWindow: 131072 },
          { provider: "modelscope", modelId: "Qwen/QwQ-32B", displayName: "QwQ 32B", contextWindow: 131072 },
          { provider: "modelscope", modelId: "deepseek-ai/DeepSeek-R1-0528", displayName: "DeepSeek R1", contextWindow: 128000 },
          { provider: "modelscope", modelId: "deepseek-ai/DeepSeek-V3.2", displayName: "DeepSeek V3.2", contextWindow: 159000 },
          { provider: "modelscope", modelId: "moonshotai/Kimi-K2.5", displayName: "Kimi K2.5", contextWindow: 262144 },
          { provider: "modelscope", modelId: "ZhipuAI/GLM-5", displayName: "GLM-5", contextWindow: 202752 },
          { provider: "modelscope", modelId: "ZhipuAI/GLM-4.7-Flash", displayName: "GLM-4.7 Flash", contextWindow: 204800 },
        ],
      },
    ],
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    url: "https://groq.com/pricing/",
    apiKeyUrl: "https://console.groq.com/keys",
    envVar: "GROQ_API_KEY",
  },
  mistral: {
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    url: "https://mistral.ai/pricing",
    apiKeyUrl: "https://console.mistral.ai/api-keys",
    envVar: "MISTRAL_API_KEY",
  },
  xai: {
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    url: "https://docs.x.ai/docs/models#models-and-pricing",
    apiKeyUrl: "https://console.x.ai/team/default/api-keys",
    envVar: "XAI_API_KEY",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    url: "https://openrouter.ai/models",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    envVar: "OPENROUTER_API_KEY",
  },
  minimax: {
    label: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    url: "https://platform.minimaxi.com/document/Price",
    apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    envVar: "MINIMAX_API_KEY",
    validationModel: "MiniMax-M2",
  },
  "minimax-cn": {
    label: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    url: "https://platform.minimaxi.com/docs/guides/pricing-paygo",
    apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    envVar: "MINIMAX_CN_API_KEY",
    fallbackModels: [
      {
        provider: "minimax-cn",
        modelId: "MiniMax-M2.1-highspeed",
        displayName: "MiniMax M2.1 Highspeed",
        cost: { input: 0.60, output: 2.40, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 192000,
      },
    ],
    subscriptionPlans: [
      {
        id: "minimax-coding",
        label: "MiniMax Coding Plan",
        baseUrl: "https://api.minimaxi.com/v1",
        subscriptionUrl: "https://platform.minimaxi.com/docs/pricing/coding-plan",
        apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
        envVar: "MINIMAX_CODING_API_KEY",
        extraModels: [
          { provider: "minimax-coding", modelId: "MiniMax-M2.5", displayName: "MiniMax M2.5", contextWindow: 192000 },
          { provider: "minimax-coding", modelId: "MiniMax-M2.5-highspeed", displayName: "MiniMax M2.5 Highspeed", contextWindow: 192000 },
          { provider: "minimax-coding", modelId: "MiniMax-M2.1", displayName: "MiniMax M2.1", contextWindow: 192000 },
          { provider: "minimax-coding", modelId: "MiniMax-M2", displayName: "MiniMax M2", contextWindow: 192000 },
        ],
      },
    ],
  },
  venice: {
    label: "Venice AI",
    baseUrl: "https://api.venice.ai/api/v1",
    url: "https://venice.ai/pricing",
    apiKeyUrl: "https://venice.ai/settings/api",
    envVar: "VENICE_API_KEY",
    extraModels: [
      { provider: "venice", modelId: "zai-org-glm-4.7", displayName: "GLM 4.7", contextWindow: 128000 },
      { provider: "venice", modelId: "deepseek-v3.2", displayName: "DeepSeek V3.2", contextWindow: 128000 },
      { provider: "venice", modelId: "openai-gpt-52", displayName: "GPT-5.2", contextWindow: 128000 },
      { provider: "venice", modelId: "claude-opus-4-6", displayName: "Claude Opus 4.6", contextWindow: 128000 },
      { provider: "venice", modelId: "grok-41-fast", displayName: "Grok 4.1 Fast", contextWindow: 128000 },
      { provider: "venice", modelId: "gemini-3-1-pro-preview", displayName: "Gemini 3.1 Pro Preview", contextWindow: 128000 },
    ],
  },
  xiaomi: {
    label: "Xiaomi (MiMo)",
    baseUrl: "https://api.xiaomimimo.com/v1",
    url: "https://mimo.xiaomi.com/",
    apiKeyUrl: "https://platform.xiaomimimo.com/",
    envVar: "XIAOMI_API_KEY",
    extraModels: [
      { provider: "xiaomi", modelId: "mimo-v2-flash", displayName: "MiMo V2 Flash", contextWindow: 131072 },
    ],
  },
  volcengine: {
    label: "Volcengine (Doubao)",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    url: "https://www.volcengine.com/pricing?product=ark_bd&tab=1",
    apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    envVar: "ARK_API_KEY",
    extraModels: [
      {
        provider: "volcengine",
        modelId: "doubao-seed-2-0-pro-260215",
        displayName: "Doubao Seed 2.0 Pro",
        cost: { input: cny(3.2), output: cny(16), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
        contextWindow: 128000,
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-2-0-code-preview-260215",
        displayName: "Doubao Seed 2.0 Code",
        cost: { input: cny(3.2), output: cny(16), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
        contextWindow: 128000,
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-2-0-lite-260215",
        displayName: "Doubao Seed 2.0 Lite",
        cost: { input: cny(0.6), output: cny(3.6), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
        contextWindow: 128000,
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-2-0-mini-260215",
        displayName: "Doubao Seed 2.0 Mini",
        cost: { input: cny(0.2), output: cny(2), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
        contextWindow: 128000,
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-1-8-251228",
        displayName: "Doubao Seed 1.8",
        cost: { input: cny(4), output: cny(16), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
        contextWindow: 128000,
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-1-6-251015",
        displayName: "Doubao Seed 1.6",
        cost: { input: cny(0.8), output: cny(8), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
        contextWindow: 128000,
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-1-6-lite-251015",
        displayName: "Doubao Seed 1.6 Lite",
        cost: { input: cny(0.4), output: cny(4), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
        contextWindow: 128000,
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-1-6-flash-250828",
        displayName: "Doubao Seed 1.6 Flash",
        cost: { input: cny(0.2), output: cny(2), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
        contextWindow: 128000,
      },
    ],
    subscriptionPlans: [
      {
        id: "volcengine-coding",
        label: "Volcengine Coding Plan (Doubao)",
        baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
        subscriptionUrl: "https://volcengine.com/L/E01Fja-Vve8/",
        apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apikey?apikey=%7B%7D",
        envVar: "ARK_CODING_API_KEY",
        extraModels: [
          {
            provider: "volcengine-coding",
            modelId: "ark-code-latest",
            displayName: "Ark Code (Latest)",
            contextWindow: 128000,
          },
        ],
      },
    ],
  },
  nvidia: {
    label: "NVIDIA (NIM)",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    url: "https://build.nvidia.com",
    apiKeyUrl: "https://build.nvidia.com/settings/api-keys",
    envVar: "NVIDIA_API_KEY",
    extraModels: [
      { provider: "nvidia", modelId: "meta/llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct", contextWindow: 128000 },
      { provider: "nvidia", modelId: "meta/llama-3.1-405b-instruct", displayName: "Llama 3.1 405B Instruct", contextWindow: 128000 },
      { provider: "nvidia", modelId: "meta/llama-3.1-8b-instruct", displayName: "Llama 3.1 8B Instruct", contextWindow: 128000 },
      { provider: "nvidia", modelId: "deepseek-ai/deepseek-v3.2", displayName: "DeepSeek V3.2", contextWindow: 159000 },
      { provider: "nvidia", modelId: "nvidia/llama-3.1-nemotron-ultra-253b-v1", displayName: "Nemotron Ultra 253B", contextWindow: 131072 },
    ],
    subscriptionPlans: [
      {
        id: "nvidia-nim",
        label: "NVIDIA NIM",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        subscriptionUrl: "https://build.nvidia.com",
        apiKeyUrl: "https://build.nvidia.com/settings/api-keys",
        envVar: "NVIDIA_NIM_API_KEY",
        extraModels: [
          { provider: "nvidia-nim", modelId: "meta/llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct", contextWindow: 128000 },
          { provider: "nvidia-nim", modelId: "meta/llama-3.1-405b-instruct", displayName: "Llama 3.1 405B Instruct", contextWindow: 128000 },
          { provider: "nvidia-nim", modelId: "meta/llama-3.1-8b-instruct", displayName: "Llama 3.1 8B Instruct", contextWindow: 128000 },
          { provider: "nvidia-nim", modelId: "deepseek-ai/deepseek-v3.2", displayName: "DeepSeek V3.2", contextWindow: 159000 },
          { provider: "nvidia-nim", modelId: "qwen/qwen2.5-72b-instruct", displayName: "Qwen 2.5 72B Instruct", contextWindow: 131072 },
          { provider: "nvidia-nim", modelId: "google/gemma-2-27b-it", displayName: "Gemma 2 27B IT", contextWindow: 8192 },
          { provider: "nvidia-nim", modelId: "mistralai/mistral-large-3-675b-instruct-2512", displayName: "Mistral Large 3 675B" },
          { provider: "nvidia-nim", modelId: "nvidia/llama-3.1-nemotron-ultra-253b-v1", displayName: "Nemotron Ultra 253B", contextWindow: 131072 },
          { provider: "nvidia-nim", modelId: "nvidia/llama-3.1-nemotron-70b-instruct", displayName: "Nemotron 70B Instruct", contextWindow: 131072 },
        ],
      },
    ],
  },
  "amazon-bedrock": {
    label: "Amazon Bedrock",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    url: "https://aws.amazon.com/bedrock/pricing/",
    apiKeyUrl: "https://console.aws.amazon.com/iam/home#/security_credentials",
    envVar: "AWS_ACCESS_KEY_ID",
  },
  ollama: {
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    url: "https://ollama.com",
    apiKeyUrl: "https://ollama.com/download",
    envVar: "OLLAMA_API_KEY",
  },
};

// ---------------------------------------------------------------------------
// Derived constants & lookup
// ---------------------------------------------------------------------------

/** Pre-built O(1) lookup map for any provider ID (root or subscription plan). */
const _metaMap = new Map<LLMProvider, ResolvedProviderMeta>();
const _parentMap = new Map<LLMProvider, RootProvider>();
const _allProviders: LLMProvider[] = [];

for (const root of Object.keys(PROVIDERS) as RootProvider[]) {
  const meta = PROVIDERS[root];
  _allProviders.push(root);
  _metaMap.set(root, {
    label: meta.label,
    baseUrl: meta.baseUrl,
    url: meta.url,
    apiKeyUrl: meta.apiKeyUrl,
    envVar: meta.envVar,
    subscriptionUrl: meta.subscriptionUrl,
    extraModels: meta.extraModels,
    fallbackModels: meta.fallbackModels,
    preferredModel: meta.preferredModel,
    api: meta.api,
    validationModel: meta.validationModel,
  });
  for (const plan of meta.subscriptionPlans ?? []) {
    _allProviders.push(plan.id);
    _parentMap.set(plan.id, root);
    _metaMap.set(plan.id, {
      label: plan.label,
      baseUrl: plan.baseUrl,
      url: meta.url, // inherit parent's pricing URL
      apiKeyUrl: plan.apiKeyUrl,
      envVar: plan.envVar,
      subscriptionUrl: plan.subscriptionUrl,
      oauth: plan.oauth,
      catalogProvider: plan.catalogProvider,
      extraModels: plan.extraModels,
      fallbackModels: plan.fallbackModels,
      preferredModel: plan.preferredModel,
      api: plan.api ?? meta.api, // inherit parent's API format
      validationModel: plan.validationModel ?? meta.validationModel, // inherit parent's validation model
    });
  }
}

/** Ordered list of all provider IDs (root + subscription plans). */
export const ALL_PROVIDERS: LLMProvider[] = _allProviders;

/**
 * Get resolved metadata for any provider ID (root or subscription plan).
 * Returns undefined if the provider ID is unknown.
 */
export function getProviderMeta(provider: LLMProvider): ResolvedProviderMeta | undefined {
  return _metaMap.get(provider);
}

/**
 * Resolve the gateway provider name for a given provider ID.
 *
 * Subscription plans that have their own `extraModels` are registered as
 * separate providers in the gateway and keep their own name. Plans that map
 * directly to a built-in catalog provider (for example `openai-codex`) also
 * keep their own gateway identity. Other plans share the parent provider.
 */
export function resolveGatewayProvider(provider: LLMProvider): string {
  const parent = _parentMap.get(provider);
  if (!parent) return provider; // root provider
  // Plan has its own extraModels → registered as separate gateway provider
  if (getProviderMeta(provider)?.extraModels) return provider;
  // Plan maps to a built-in provider with the same ID
  if (getProviderMeta(provider)?.catalogProvider === provider) return provider;
  // Otherwise use parent's name
  return parent;
}

function getSupplementalModels(provider: LLMProvider): ModelConfig[] {
  const meta = getProviderMeta(provider);
  const extra = meta?.extraModels ?? [];
  const fallback = meta?.fallbackModels ?? [];
  if (extra.length === 0) return fallback;
  if (fallback.length === 0) return extra;
  const seen = new Set(extra.map((m) => m.modelId));
  return [...extra, ...fallback.filter((m) => !seen.has(m.modelId))];
}

/** Provider IDs that appear in the subscription tab (all nested plan IDs). */
export const SUBSCRIPTION_PROVIDER_IDS: LLMProvider[] = (() => {
  const ids: LLMProvider[] = [];
  for (const root of Object.keys(PROVIDERS) as RootProvider[]) {
    for (const plan of PROVIDERS[root].subscriptionPlans ?? []) {
      ids.push(plan.id);
    }
  }
  return ids;
})();

/** Provider IDs that appear in the API tab (excludes subscription plans and local providers). */
export const API_PROVIDER_IDS: LLMProvider[] = (() => {
  const subSet = new Set(SUBSCRIPTION_PROVIDER_IDS);
  const localSet = new Set<LLMProvider>(["ollama"]);
  return ALL_PROVIDERS.filter((p) => !subSet.has(p) && !localSet.has(p));
})();

/**
 * Subscription providers for which OpenClaw's plugin-sdk exposes a usage fetcher
 * (`openclaw/plugin-sdk/provider-usage`). Only keys whose provider id is in this
 * set are allowed to show the "Usage" button on the Providers page. Any other
 * subscription-type key (no fetcher) is excluded — the button is hidden.
 *
 * Kept separate from `SUBSCRIPTION_PROVIDER_IDS` on purpose: a provider can be
 * authenticable via OAuth without exposing a quota API. Adding an id here
 * requires a matching fetcher branch in Desktop's `LLMProviderManager.fetchKeyUsage`.
 *
 * Declared as a `readonly` literal tuple so `UsageQueryableProvider` below is a
 * narrow union — adding an id without a matching dispatch branch fails the
 * exhaustive-switch check at compile time.
 *
 * ## Why Claude is NOT here
 *
 * Our UI lets users paste the token output by `claude setup-token`. That token
 * is scoped for the Anthropic Messages API (inference) but lacks `user:profile`,
 * which Anthropic's OAuth quota endpoint (`/api/oauth/usage`) requires — so
 * fetching quota for such tokens fails with HTTP 403 "OAuth token does not meet
 * scope requirement user:profile".
 *
 * OpenClaw upstream has the same primary OAuth path and falls back to the
 * claude.ai browser sessionKey cookie when the env vars `CLAUDE_AI_SESSION_KEY`
 * / `CLAUDE_WEB_COOKIE` are set — see `vendor/openclaw/src/infra/provider-usage.fetch.claude.ts`.
 * EasyClaw's target audience is non-developers who shouldn't be expected to
 * harvest cookies from DevTools, so we'd rather hide the button than ship a
 * power-user-only workaround or a misleading error. Re-adding `claude` here
 * requires either (a) a full Anthropic OAuth authorization-code flow that
 * requests `user:profile`, or (b) a Panel UX for pasting the session cookie.
 */
export const USAGE_QUERYABLE_PROVIDERS = [
  "openai-codex",
  "gemini",
] as const satisfies readonly LLMProvider[];

export type UsageQueryableProvider = (typeof USAGE_QUERYABLE_PROVIDERS)[number];

export function isUsageQueryableProvider(p: LLMProvider): p is UsageQueryableProvider {
  return (USAGE_QUERYABLE_PROVIDERS as readonly LLMProvider[]).includes(p);
}

/**
 * Subscription providers for which EasyClaw drives a full OAuth authorization-
 * code flow end-to-end (not manual token paste). Only these keys show the
 * "Re-authenticate" button and accept the `POST /api/provider-keys/:id/reauth`
 * endpoint — Claude is NOT here because our UI accepts tokens from
 * `claude setup-token` rather than running the OAuth flow itself.
 *
 * Single source of truth consumed by Panel UI, Desktop REST handler, and the
 * Desktop action implementation — keeping them in sync prevents silent drift
 * where one surface allows re-auth and another rejects it.
 */
export const REAUTH_SUPPORTED_PROVIDERS = [
  "openai-codex",
  "gemini",
] as const satisfies readonly LLMProvider[];

export type ReauthSupportedProvider = (typeof REAUTH_SUPPORTED_PROVIDERS)[number];

export function isReauthSupportedProvider(p: LLMProvider): p is ReauthSupportedProvider {
  return (REAUTH_SUPPORTED_PROVIDERS as readonly LLMProvider[]).includes(p);
}

/** Provider IDs that appear in the Local LLM tab. */
export const LOCAL_PROVIDER_IDS: LLMProvider[] = ["ollama"];

// ---------------------------------------------------------------------------
// Known regions & secret keys
// ---------------------------------------------------------------------------

/** Known regions. */
export type Region = "us" | "eu" | "cn" | (string & {});

/**
 * Maps each provider to the settings key used to store its API key.
 * e.g. "openai" -> "openai-api-key"
 */
export function providerSecretKey(provider: LLMProvider): string {
  return `${provider}-api-key`;
}

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

/**
 * All known models grouped by provider.
 *
 * At startup this only contains local supplemental models (runtime extras or
 * UI-only fallbacks) from PROVIDERS. Once the gateway's models.json is loaded,
 * `initKnownModels()` populates it with OpenClaw's full catalog.
 */
// eslint-disable-next-line import/no-mutable-exports
export let KNOWN_MODELS: Partial<Record<LLMProvider, ModelConfig[]>> =
  Object.fromEntries(
    ALL_PROVIDERS
      .map((p) => [p, getSupplementalModels(p)] as const)
      .filter(([, models]) => models.length > 0),
  );

/**
 * Populate KNOWN_MODELS from the gateway's model catalog.
 *
 * Called by `readFullModelCatalog()` in @rivonclaw/gateway after reading
 * models.json. Local supplemental models (runtime extras or fallback models)
 * are placed first because they carry richer local metadata like cost, and
 * catalog entries that don't overlap are appended after.
 */
export function initKnownModels(
  catalog: Record<string, Array<{ id: string; name: string; contextWindow?: number; contextTokens?: number }>>,
): void {
  const result: Partial<Record<LLMProvider, ModelConfig[]>> = {};

  for (const [provider, entries] of Object.entries(catalog)) {
    if (!ALL_PROVIDERS.includes(provider as LLMProvider)) continue;
    const p = provider as LLMProvider;
    const catalogModels: ModelConfig[] = entries.map((e) => ({
      provider: p,
      modelId: e.id,
      displayName: e.name,
      contextWindow: e.contextWindow,
      contextTokens: e.contextTokens,
    }));
    const meta = getProviderMeta(p);
    const extra = meta?.extraModels ?? [];
    const fallback = meta?.fallbackModels ?? [];
    const extraIds = new Set(extra.map((m) => m.modelId));
    const catalogWithoutExtra = catalogModels.filter((m) => !extraIds.has(m.modelId));

    if (extra.length > 0) {
      const existingIds = new Set([...extraIds, ...catalogWithoutExtra.map((m) => m.modelId)]);
      result[p] = [
        ...extra,
        ...catalogWithoutExtra,
        ...fallback.filter((m) => !existingIds.has(m.modelId)),
      ];
    } else {
      const catalogIds = new Set(catalogModels.map((m) => m.modelId));
      result[p] = [
        ...catalogModels,
        ...fallback.filter((m) => !catalogIds.has(m.modelId)),
      ];
    }
  }

  // Include providers that only have local supplemental models.
  for (const p of ALL_PROVIDERS) {
    if (result[p]) continue;
    const supplemental = getSupplementalModels(p);
    if (supplemental.length > 0) {
      result[p] = supplemental;
    }
  }

  KNOWN_MODELS = result;
}

// ---------------------------------------------------------------------------
// Default model resolution
// ---------------------------------------------------------------------------

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
 * If a preferred default is configured and exists in the provider's list,
 * returns that; otherwise returns the first model.
 */
export function getDefaultModelForProvider(
  provider: LLMProvider,
): ModelConfig | undefined {
  const models = KNOWN_MODELS[provider];
  if (!models || models.length === 0) return undefined;
  const preferred = getProviderMeta(provider)?.preferredModel;
  if (preferred === "latest") {
    return models[0];
  }
  if (preferred) {
    const match = models.find((m) => m.modelId === preferred);
    if (match) return match;
  }
  return models[0];
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
      "zhipu-coding",
      "kimi",
      "moonshot-coding",
      "qwen",
      "qwen-coding",
      "modelscope",
      "volcengine",
      "minimax-cn",
      "minimax-coding",
      "xiaomi",
      "nvidia-nim",
      "openai",
      "openai-codex",
      "anthropic",
      "claude",
      "google",
      "ollama",
    ];
  }
  return [
    "openai",
    "openai-codex",
    "anthropic",
    "claude",
    "google",
    "deepseek",
    "moonshot",
    "zai",
    "nvidia-nim",
    "groq",
    "mistral",
    "xai",
    "openrouter",
    "ollama",
  ];
}

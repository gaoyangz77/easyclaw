/** Supported LLM providers (cloud APIs, subscriptions, and local servers). */
export type LLMProvider =
  | "openai"
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
export type RootProvider = Exclude<LLMProvider, "zhipu-coding" | "moonshot-coding" | "minimax-coding" | "volcengine-coding" | "qwen-coding" | "modelscope" | "nvidia-nim" | "gemini" | "claude">;

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
  /** Preferred default model ID for this plan. */
  preferredModel?: string;
  /** API format used by this plan's endpoint (defaults to "openai-completions"). */
  api?: string;
  /** Lightweight model ID for API-key validation when extraModels / catalog aren't loaded yet. */
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
  /** Preferred default model ID for this provider. */
  preferredModel?: string;
  /** API format used by this provider's endpoint (defaults to "openai-completions"). */
  api?: string;
  /** Lightweight model ID for API-key validation when extraModels / catalog aren't loaded yet. */
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
  extraModels?: ModelConfig[];
  preferredModel?: string;
  /** API format used by this provider's endpoint (defaults to "openai-completions"). */
  api?: string;
  /** Lightweight model ID for API-key validation when extraModels / catalog aren't loaded yet. */
  validationModel?: string;
}

// CNY → USD conversion rate used for cost estimates below.
export const CNY_USD = 7.0;
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
      { provider: "deepseek", modelId: "deepseek-chat", displayName: "DeepSeek Chat (V3)" },
      { provider: "deepseek", modelId: "deepseek-reasoner", displayName: "DeepSeek Reasoner (R1)" },
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
      },
      {
        provider: "zhipu",
        modelId: "glm-5-code",
        displayName: "GLM-5-Code",
        cost: { input: cny(6), output: cny(28), cacheRead: 0, cacheWrite: 0 },
      },
      {
        provider: "zhipu",
        modelId: "glm-4.7-flash",
        displayName: "GLM-4.7-Flash",
        cost: FREE_COST,
      },
      {
        provider: "zhipu",
        modelId: "glm-4.7",
        displayName: "GLM-4.7",
        cost: { input: cny(4), output: cny(16), cacheRead: 0, cacheWrite: 0 },
      },
      {
        provider: "zhipu",
        modelId: "glm-4.6",
        displayName: "GLM-4.6",
        cost: { input: cny(4), output: cny(16), cacheRead: 0, cacheWrite: 0 },
      },
      {
        provider: "zhipu",
        modelId: "glm-4.6v",
        displayName: "GLM-4.6V",
        cost: { input: cny(2), output: cny(6), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
      },
      {
        provider: "zhipu",
        modelId: "glm-4.5",
        displayName: "GLM-4.5",
        cost: { input: cny(4), output: cny(16), cacheRead: 0, cacheWrite: 0 },
      },
      {
        provider: "zhipu",
        modelId: "glm-4.5-flash",
        displayName: "GLM-4.5-Flash",
        cost: FREE_COST,
      },
      {
        provider: "zhipu",
        modelId: "glm-4.5-air",
        displayName: "GLM-4.5-Air",
        cost: { input: cny(1), output: cny(8), cacheRead: 0, cacheWrite: 0 },
      },
      {
        provider: "zhipu",
        modelId: "glm-4.5v",
        displayName: "GLM-4.5V",
        cost: { input: cny(4), output: cny(12), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
      },
      {
        provider: "zhipu",
        modelId: "glm-4-plus",
        displayName: "GLM-4 Plus",
        cost: { input: cny(5), output: cny(5), cacheRead: 0, cacheWrite: 0 },
      },
      {
        provider: "zhipu",
        modelId: "glm-4-flash",
        displayName: "GLM-4 Flash",
        cost: FREE_COST,
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
          },
          {
            provider: "zhipu-coding",
            modelId: "glm-4.7",
            displayName: "GLM-4.7",
            cost: { input: cny(4), output: cny(16), cacheRead: 0, cacheWrite: 0 },
          },
          {
            provider: "zhipu-coding",
            modelId: "glm-4.5-air",
            displayName: "GLM-4.5-Air",
            cost: { input: cny(1), output: cny(8), cacheRead: 0, cacheWrite: 0 },
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
      },
      {
        provider: "moonshot",
        modelId: "kimi-k2-thinking",
        displayName: "Kimi K2 Thinking",
      },
      {
        provider: "moonshot",
        modelId: "kimi-k2-0905-preview",
        displayName: "Kimi K2",
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
      },
      {
        provider: "kimi",
        modelId: "kimi-k2-thinking",
        displayName: "Kimi K2 Thinking",
      },
      {
        provider: "kimi",
        modelId: "kimi-k2-0905-preview",
        displayName: "Kimi K2",
      },
      {
        provider: "kimi",
        modelId: "moonshot-v1-128k",
        displayName: "Moonshot V1 128K",
      },
      {
        provider: "kimi",
        modelId: "moonshot-v1-32k",
        displayName: "Moonshot V1 32K",
      },
      {
        provider: "kimi",
        modelId: "moonshot-v1-8k",
        displayName: "Moonshot V1 8K",
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
      { provider: "qwen", modelId: "qwen-max", displayName: "Qwen Max" },
      { provider: "qwen", modelId: "qwen-plus", displayName: "Qwen Plus" },
      { provider: "qwen", modelId: "qwen-turbo", displayName: "Qwen Turbo" },
      { provider: "qwen", modelId: "qwen-long", displayName: "Qwen Long" },
      { provider: "qwen", modelId: "qwen3-235b-a22b", displayName: "Qwen3 235B" },
      { provider: "qwen", modelId: "qwen3-30b-a3b", displayName: "Qwen3 30B" },
      { provider: "qwen", modelId: "qwen3-coder-plus", displayName: "Qwen3 Coder Plus" },
      { provider: "qwen", modelId: "qwq-plus", displayName: "QwQ Plus" },
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
          { provider: "qwen-coding", modelId: "qwen3.5-plus", displayName: "Qwen3.5 Plus" },
          { provider: "qwen-coding", modelId: "qwen3-max-2026-01-23", displayName: "Qwen3 Max" },
          { provider: "qwen-coding", modelId: "qwen3-coder-next", displayName: "Qwen3 Coder Next" },
          { provider: "qwen-coding", modelId: "qwen3-coder-plus", displayName: "Qwen3 Coder Plus" },
          { provider: "qwen-coding", modelId: "glm-4.7", displayName: "GLM-4.7" },
          { provider: "qwen-coding", modelId: "kimi-k2.5", displayName: "Kimi K2.5" },
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
          { provider: "modelscope", modelId: "Qwen/Qwen3.5-397B-A17B", displayName: "Qwen3.5 397B" },
          { provider: "modelscope", modelId: "Qwen/Qwen3-235B-A22B-Instruct-2507", displayName: "Qwen3 235B Instruct" },
          { provider: "modelscope", modelId: "Qwen/Qwen3-235B-A22B-Thinking-2507", displayName: "Qwen3 235B Thinking" },
          { provider: "modelscope", modelId: "Qwen/Qwen3-Coder-480B-A35B-Instruct", displayName: "Qwen3 Coder 480B" },
          { provider: "modelscope", modelId: "Qwen/Qwen3-Coder-30B-A3B-Instruct", displayName: "Qwen3 Coder 30B" },
          { provider: "modelscope", modelId: "Qwen/Qwen3-32B", displayName: "Qwen3 32B" },
          { provider: "modelscope", modelId: "Qwen/QwQ-32B", displayName: "QwQ 32B" },
          { provider: "modelscope", modelId: "deepseek-ai/DeepSeek-R1-0528", displayName: "DeepSeek R1" },
          { provider: "modelscope", modelId: "deepseek-ai/DeepSeek-V3.2", displayName: "DeepSeek V3.2" },
          { provider: "modelscope", modelId: "moonshotai/Kimi-K2.5", displayName: "Kimi K2.5" },
          { provider: "modelscope", modelId: "ZhipuAI/GLM-5", displayName: "GLM-5" },
          { provider: "modelscope", modelId: "ZhipuAI/GLM-4.7-Flash", displayName: "GLM-4.7 Flash" },
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
    extraModels: [
      {
        provider: "minimax-cn",
        modelId: "MiniMax-M2.5",
        displayName: "MiniMax M2.5",
        cost: { input: 0.30, output: 1.20, cacheRead: 0, cacheWrite: 0 },
      },
      {
        provider: "minimax-cn",
        modelId: "MiniMax-M2.5-highspeed",
        displayName: "MiniMax M2.5 Highspeed",
        cost: { input: 0.60, output: 2.40, cacheRead: 0, cacheWrite: 0 },
      },
      {
        provider: "minimax-cn",
        modelId: "MiniMax-M2.1",
        displayName: "MiniMax M2.1",
        cost: { input: 0.30, output: 1.20, cacheRead: 0, cacheWrite: 0 },
      },
      {
        provider: "minimax-cn",
        modelId: "MiniMax-M2.1-highspeed",
        displayName: "MiniMax M2.1 Highspeed",
        cost: { input: 0.60, output: 2.40, cacheRead: 0, cacheWrite: 0 },
      },
      {
        provider: "minimax-cn",
        modelId: "MiniMax-M2",
        displayName: "MiniMax M2",
        cost: { input: 0.30, output: 1.20, cacheRead: 0, cacheWrite: 0 },
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
          { provider: "minimax-coding", modelId: "MiniMax-M2.5", displayName: "MiniMax M2.5" },
          { provider: "minimax-coding", modelId: "MiniMax-M2.5-highspeed", displayName: "MiniMax M2.5 Highspeed" },
          { provider: "minimax-coding", modelId: "MiniMax-M2.1", displayName: "MiniMax M2.1" },
          { provider: "minimax-coding", modelId: "MiniMax-M2", displayName: "MiniMax M2" },
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
      { provider: "venice", modelId: "zai-org-glm-4.7", displayName: "GLM 4.7" },
      { provider: "venice", modelId: "deepseek-v3.2", displayName: "DeepSeek V3.2" },
      { provider: "venice", modelId: "openai-gpt-52", displayName: "GPT-5.2" },
      { provider: "venice", modelId: "claude-opus-4-6", displayName: "Claude Opus 4.6" },
      { provider: "venice", modelId: "grok-41-fast", displayName: "Grok 4.1 Fast" },
      { provider: "venice", modelId: "gemini-3-1-pro-preview", displayName: "Gemini 3.1 Pro Preview" },
    ],
  },
  xiaomi: {
    label: "Xiaomi (MiMo)",
    baseUrl: "https://api.xiaomimimo.com/v1",
    url: "https://mimo.xiaomi.com/",
    apiKeyUrl: "https://platform.xiaomimimo.com/",
    envVar: "XIAOMI_API_KEY",
    extraModels: [
      { provider: "xiaomi", modelId: "mimo-v2-flash", displayName: "MiMo V2 Flash" },
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
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-2-0-code-preview-260215",
        displayName: "Doubao Seed 2.0 Code",
        cost: { input: cny(3.2), output: cny(16), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-2-0-lite-260215",
        displayName: "Doubao Seed 2.0 Lite",
        cost: { input: cny(0.6), output: cny(3.6), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-2-0-mini-260215",
        displayName: "Doubao Seed 2.0 Mini",
        cost: { input: cny(0.2), output: cny(2), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-1-8-251228",
        displayName: "Doubao Seed 1.8",
        cost: { input: cny(4), output: cny(16), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-1-6-251015",
        displayName: "Doubao Seed 1.6",
        cost: { input: cny(0.8), output: cny(8), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-1-6-lite-251015",
        displayName: "Doubao Seed 1.6 Lite",
        cost: { input: cny(0.4), output: cny(4), cacheRead: 0, cacheWrite: 0 },
      },
      {
        provider: "volcengine",
        modelId: "doubao-seed-1-6-flash-250828",
        displayName: "Doubao Seed 1.6 Flash",
        cost: { input: cny(0.2), output: cny(2), cacheRead: 0, cacheWrite: 0 },
        supportsVision: true,
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
      { provider: "nvidia", modelId: "meta/llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct" },
      { provider: "nvidia", modelId: "meta/llama-3.1-405b-instruct", displayName: "Llama 3.1 405B Instruct" },
      { provider: "nvidia", modelId: "meta/llama-3.1-8b-instruct", displayName: "Llama 3.1 8B Instruct" },
      { provider: "nvidia", modelId: "deepseek-ai/deepseek-v3.2", displayName: "DeepSeek V3.2" },
      { provider: "nvidia", modelId: "nvidia/llama-3.1-nemotron-ultra-253b-v1", displayName: "Nemotron Ultra 253B" },
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
          { provider: "nvidia-nim", modelId: "meta/llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct" },
          { provider: "nvidia-nim", modelId: "meta/llama-3.1-405b-instruct", displayName: "Llama 3.1 405B Instruct" },
          { provider: "nvidia-nim", modelId: "meta/llama-3.1-8b-instruct", displayName: "Llama 3.1 8B Instruct" },
          { provider: "nvidia-nim", modelId: "deepseek-ai/deepseek-v3.2", displayName: "DeepSeek V3.2" },
          { provider: "nvidia-nim", modelId: "qwen/qwen2.5-72b-instruct", displayName: "Qwen 2.5 72B Instruct" },
          { provider: "nvidia-nim", modelId: "google/gemma-2-27b-it", displayName: "Gemma 2 27B IT" },
          { provider: "nvidia-nim", modelId: "mistralai/mistral-large-3-675b-instruct-2512", displayName: "Mistral Large 3 675B" },
          { provider: "nvidia-nim", modelId: "nvidia/llama-3.1-nemotron-ultra-253b-v1", displayName: "Nemotron Ultra 253B" },
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
      extraModels: plan.extraModels,
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
 * separate providers in the gateway and keep their own name. Plans without
 * `extraModels` share the parent provider's gateway identity.
 */
export function resolveGatewayProvider(provider: LLMProvider): string {
  const parent = _parentMap.get(provider);
  if (!parent) return provider; // root provider
  // Plan has its own extraModels → registered as separate gateway provider
  if (getProviderMeta(provider)?.extraModels) return provider;
  // Otherwise use parent's name
  return parent;
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
 * At startup this only contains extraModels from PROVIDERS. Once the gateway's
 * models.json is loaded, `initKnownModels()` populates it with OpenClaw's
 * full catalog.
 */
// eslint-disable-next-line import/no-mutable-exports
export let KNOWN_MODELS: Partial<Record<LLMProvider, ModelConfig[]>> =
  Object.fromEntries(
    ALL_PROVIDERS
      .filter((p) => getProviderMeta(p)?.extraModels)
      .map((p) => [p, getProviderMeta(p)!.extraModels!]),
  );

/**
 * Populate KNOWN_MODELS from the gateway's model catalog.
 *
 * Called by `readFullModelCatalog()` in @easyclaw/gateway after reading
 * models.json. extraModels supplements catalog data — items from extraModels
 * are placed first (they carry richer data like cost) and catalog entries
 * that don't overlap are appended after.
 */
export function initKnownModels(
  catalog: Record<string, Array<{ id: string; name: string }>>,
): void {
  const result: Partial<Record<LLMProvider, ModelConfig[]>> = {};

  for (const [provider, entries] of Object.entries(catalog)) {
    if (!ALL_PROVIDERS.includes(provider as LLMProvider)) continue;
    const p = provider as LLMProvider;
    const catalogModels: ModelConfig[] = entries.map((e) => ({
      provider: p,
      modelId: e.id,
      displayName: e.name,
    }));
    const extra = getProviderMeta(p)?.extraModels ?? [];
    const extraIds = new Set(extra.map((m) => m.modelId));
    // extraModels first (richer data with cost), then catalog entries not in extraModels
    result[p] = [...extra, ...catalogModels.filter((m) => !extraIds.has(m.modelId))];
  }

  // Include extraModels-only providers not in catalog at all
  for (const p of ALL_PROVIDERS) {
    if (result[p]) continue;
    const extra = getProviderMeta(p)?.extraModels;
    if (extra && extra.length > 0) {
      result[p] = extra;
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
      "anthropic",
      "claude",
      "google",
      "ollama",
    ];
  }
  return [
    "openai",
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

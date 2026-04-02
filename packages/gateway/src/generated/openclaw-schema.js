// AUTO-GENERATED from vendor/openclaw — do not edit manually.
// Re-generate with: node scripts/generate-vendor-artifacts.mjs

// vendor/openclaw/src/config/zod-schema.ts
import { z as z17 } from "zod";

// vendor/openclaw/src/cli/parse-bytes.ts
var UNIT_MULTIPLIERS = {
  b: 1,
  kb: 1024,
  k: 1024,
  mb: 1024 ** 2,
  m: 1024 ** 2,
  gb: 1024 ** 3,
  g: 1024 ** 3,
  tb: 1024 ** 4,
  t: 1024 ** 4
};
function parseByteSize(raw, opts) {
  const trimmed = String(raw ?? "").trim().toLowerCase();
  if (!trimmed) {
    throw new Error("invalid byte size (empty)");
  }
  const m = /^(\d+(?:\.\d+)?)([a-z]+)?$/.exec(trimmed);
  if (!m) {
    throw new Error(`invalid byte size: ${raw}`);
  }
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid byte size: ${raw}`);
  }
  const unit = (m[2] ?? opts?.defaultUnit ?? "b").toLowerCase();
  const multiplier = UNIT_MULTIPLIERS[unit];
  if (!multiplier) {
    throw new Error(`invalid byte size unit: ${raw}`);
  }
  const bytes = Math.round(value * multiplier);
  if (!Number.isFinite(bytes)) {
    throw new Error(`invalid byte size: ${raw}`);
  }
  return bytes;
}

// vendor/openclaw/src/cli/parse-duration.ts
var DURATION_MULTIPLIERS = {
  ms: 1,
  s: 1e3,
  m: 6e4,
  h: 36e5,
  d: 864e5
};
function parseDurationMs(raw, opts) {
  const trimmed = String(raw ?? "").trim().toLowerCase();
  if (!trimmed) {
    throw new Error("invalid duration (empty)");
  }
  const single = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(trimmed);
  if (single) {
    const value = Number(single[1]);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`invalid duration: ${raw}`);
    }
    const unit = single[2] ?? opts?.defaultUnit ?? "ms";
    const ms2 = Math.round(value * DURATION_MULTIPLIERS[unit]);
    if (!Number.isFinite(ms2)) {
      throw new Error(`invalid duration: ${raw}`);
    }
    return ms2;
  }
  let totalMs = 0;
  let consumed = 0;
  const tokenRe = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;
  for (const match of trimmed.matchAll(tokenRe)) {
    const [full, valueRaw, unitRaw] = match;
    const index = match.index ?? -1;
    if (!full || !valueRaw || !unitRaw || index < 0) {
      throw new Error(`invalid duration: ${raw}`);
    }
    if (index !== consumed) {
      throw new Error(`invalid duration: ${raw}`);
    }
    const value = Number(valueRaw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`invalid duration: ${raw}`);
    }
    const multiplier = DURATION_MULTIPLIERS[unitRaw];
    if (!multiplier) {
      throw new Error(`invalid duration: ${raw}`);
    }
    totalMs += value * multiplier;
    consumed += full.length;
  }
  if (consumed !== trimmed.length || consumed === 0) {
    throw new Error(`invalid duration: ${raw}`);
  }
  const ms = Math.round(totalMs);
  if (!Number.isFinite(ms)) {
    throw new Error(`invalid duration: ${raw}`);
  }
  return ms;
}

// vendor/openclaw/src/config/zod-schema.agent-runtime.ts
import { z as z5 } from "zod";

// vendor/openclaw/src/agents/sandbox/network-mode.ts
function normalizeNetworkMode(network) {
  const normalized = network?.trim().toLowerCase();
  return normalized || void 0;
}
function getBlockedNetworkModeReason(params) {
  const normalized = normalizeNetworkMode(params.network);
  if (!normalized) {
    return null;
  }
  if (normalized === "host") {
    return "host";
  }
  if (normalized.startsWith("container:") && params.allowContainerNamespaceJoin !== true) {
    return "container_namespace_join";
  }
  return null;
}

// vendor/openclaw/src/config/zod-schema.agent-model.ts
import { z } from "zod";
var AgentModelSchema = z.union([
  z.string(),
  z.object({
    primary: z.string().optional(),
    fallbacks: z.array(z.string()).optional()
  }).strict()
]);

// vendor/openclaw/src/config/zod-schema.core.ts
import path from "node:path";
import { z as z4 } from "zod";

// vendor/openclaw/src/infra/exec-safety.ts
var SHELL_METACHARS = /[;&|`$<>]/;
var CONTROL_CHARS = /[\r\n]/;
var QUOTE_CHARS = /["']/;
var BARE_NAME_PATTERN = /^[A-Za-z0-9._+-]+$/;
function isLikelyPath(value) {
  if (value.startsWith(".") || value.startsWith("~")) {
    return true;
  }
  if (value.includes("/") || value.includes("\\")) {
    return true;
  }
  return /^[A-Za-z]:[\\/]/.test(value);
}
function isSafeExecutableValue(value) {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes("\0")) {
    return false;
  }
  if (CONTROL_CHARS.test(trimmed)) {
    return false;
  }
  if (SHELL_METACHARS.test(trimmed)) {
    return false;
  }
  if (QUOTE_CHARS.test(trimmed)) {
    return false;
  }
  if (isLikelyPath(trimmed)) {
    return true;
  }
  if (trimmed.startsWith("-")) {
    return false;
  }
  return BARE_NAME_PATTERN.test(trimmed);
}

// vendor/openclaw/src/config/types.secrets.ts
var DEFAULT_SECRET_PROVIDER_ALIAS = "default";
var ENV_SECRET_TEMPLATE_RE = /^\$\{([A-Z][A-Z0-9_]{0,127})\}$/;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSecretRef(value) {
  if (!isRecord(value)) {
    return false;
  }
  if (Object.keys(value).length !== 3) {
    return false;
  }
  return (value.source === "env" || value.source === "file" || value.source === "exec") && typeof value.provider === "string" && value.provider.trim().length > 0 && typeof value.id === "string" && value.id.trim().length > 0;
}
function isLegacySecretRefWithoutProvider(value) {
  if (!isRecord(value)) {
    return false;
  }
  return (value.source === "env" || value.source === "file" || value.source === "exec") && typeof value.id === "string" && value.id.trim().length > 0 && value.provider === void 0;
}
function parseEnvTemplateSecretRef(value, provider = DEFAULT_SECRET_PROVIDER_ALIAS) {
  if (typeof value !== "string") {
    return null;
  }
  const match = ENV_SECRET_TEMPLATE_RE.exec(value.trim());
  if (!match) {
    return null;
  }
  return {
    source: "env",
    provider: provider.trim() || DEFAULT_SECRET_PROVIDER_ALIAS,
    id: match[1]
  };
}
function coerceSecretRef(value, defaults) {
  if (isSecretRef(value)) {
    return value;
  }
  if (isLegacySecretRefWithoutProvider(value)) {
    const provider = value.source === "env" ? defaults?.env ?? DEFAULT_SECRET_PROVIDER_ALIAS : value.source === "file" ? defaults?.file ?? DEFAULT_SECRET_PROVIDER_ALIAS : defaults?.exec ?? DEFAULT_SECRET_PROVIDER_ALIAS;
    return {
      source: value.source,
      provider,
      id: value.id
    };
  }
  const envTemplate = parseEnvTemplateSecretRef(value, defaults?.env);
  if (envTemplate) {
    return envTemplate;
  }
  return null;
}
function hasConfiguredSecretInput(value, defaults) {
  if (normalizeSecretInputString(value)) {
    return true;
  }
  return coerceSecretRef(value, defaults) !== null;
}
function normalizeSecretInputString(value) {
  if (typeof value !== "string") {
    return void 0;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}

// vendor/openclaw/src/secrets/ref-contract.ts
var FILE_SECRET_REF_SEGMENT_PATTERN = /^(?:[^~]|~0|~1)*$/;
var EXEC_SECRET_REF_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
var SINGLE_VALUE_FILE_REF_ID = "value";
function isValidFileSecretRefId(value) {
  if (value === SINGLE_VALUE_FILE_REF_ID) {
    return true;
  }
  if (!value.startsWith("/")) {
    return false;
  }
  return value.slice(1).split("/").every((segment) => FILE_SECRET_REF_SEGMENT_PATTERN.test(segment));
}
function validateExecSecretRefId(value) {
  if (!EXEC_SECRET_REF_ID_PATTERN.test(value)) {
    return { ok: false, reason: "pattern" };
  }
  for (const segment of value.split("/")) {
    if (segment === "." || segment === "..") {
      return { ok: false, reason: "traversal-segment" };
    }
  }
  return { ok: true };
}
function isValidExecSecretRefId(value) {
  return validateExecSecretRefId(value).ok;
}
function formatExecSecretRefIdValidationMessage() {
  return [
    "Exec secret reference id must match /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/",
    'and must not include "." or ".." path segments',
    '(example: "vault/openai/api-key").'
  ].join(" ");
}

// vendor/openclaw/src/config/types.models.ts
var MODEL_APIS = [
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "google-generative-ai",
  "github-copilot",
  "bedrock-converse-stream",
  "ollama",
  "azure-openai-responses"
];

// vendor/openclaw/src/config/zod-schema.allowdeny.ts
import { z as z2 } from "zod";
var AllowDenyActionSchema = z2.union([z2.literal("allow"), z2.literal("deny")]);
var AllowDenyChatTypeSchema = z2.union([
  z2.literal("direct"),
  z2.literal("group"),
  z2.literal("channel"),
  /** @deprecated Use `direct` instead. Kept for backward compatibility. */
  z2.literal("dm")
]).optional();
function createAllowDenyChannelRulesSchema() {
  return z2.object({
    default: AllowDenyActionSchema.optional(),
    rules: z2.array(
      z2.object({
        action: AllowDenyActionSchema,
        match: z2.object({
          channel: z2.string().optional(),
          chatType: AllowDenyChatTypeSchema,
          keyPrefix: z2.string().optional(),
          rawKeyPrefix: z2.string().optional()
        }).strict().optional()
      }).strict()
    ).optional()
  }).strict().optional();
}

// vendor/openclaw/src/config/zod-schema.sensitive.ts
import { z as z3 } from "zod";
var sensitive = z3.registry();

// vendor/openclaw/src/config/zod-schema.core.ts
var ENV_SECRET_REF_ID_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
var SECRET_PROVIDER_ALIAS_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
var WINDOWS_ABS_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
var WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\]+\\[^\\]+/;
function isAbsolutePath(value) {
  return path.isAbsolute(value) || WINDOWS_ABS_PATH_PATTERN.test(value) || WINDOWS_UNC_PATH_PATTERN.test(value);
}
var EnvSecretRefSchema = z4.object({
  source: z4.literal("env"),
  provider: z4.string().regex(
    SECRET_PROVIDER_ALIAS_PATTERN,
    'Secret reference provider must match /^[a-z][a-z0-9_-]{0,63}$/ (example: "default").'
  ),
  id: z4.string().regex(
    ENV_SECRET_REF_ID_PATTERN,
    'Env secret reference id must match /^[A-Z][A-Z0-9_]{0,127}$/ (example: "OPENAI_API_KEY").'
  )
}).strict();
var FileSecretRefSchema = z4.object({
  source: z4.literal("file"),
  provider: z4.string().regex(
    SECRET_PROVIDER_ALIAS_PATTERN,
    'Secret reference provider must match /^[a-z][a-z0-9_-]{0,63}$/ (example: "default").'
  ),
  id: z4.string().refine(
    isValidFileSecretRefId,
    'File secret reference id must be an absolute JSON pointer (example: "/providers/openai/apiKey"), or "value" for singleValue mode.'
  )
}).strict();
var ExecSecretRefSchema = z4.object({
  source: z4.literal("exec"),
  provider: z4.string().regex(
    SECRET_PROVIDER_ALIAS_PATTERN,
    'Secret reference provider must match /^[a-z][a-z0-9_-]{0,63}$/ (example: "default").'
  ),
  id: z4.string().refine(isValidExecSecretRefId, formatExecSecretRefIdValidationMessage())
}).strict();
var SecretRefSchema = z4.discriminatedUnion("source", [
  EnvSecretRefSchema,
  FileSecretRefSchema,
  ExecSecretRefSchema
]);
var SecretInputSchema = z4.union([z4.string(), SecretRefSchema]);
var SecretsEnvProviderSchema = z4.object({
  source: z4.literal("env"),
  allowlist: z4.array(z4.string().regex(ENV_SECRET_REF_ID_PATTERN)).max(256).optional()
}).strict();
var SecretsFileProviderSchema = z4.object({
  source: z4.literal("file"),
  path: z4.string().min(1),
  mode: z4.union([z4.literal("singleValue"), z4.literal("json")]).optional(),
  timeoutMs: z4.number().int().positive().max(12e4).optional(),
  maxBytes: z4.number().int().positive().max(20 * 1024 * 1024).optional()
}).strict();
var SecretsExecProviderSchema = z4.object({
  source: z4.literal("exec"),
  command: z4.string().min(1).refine((value) => isSafeExecutableValue(value), "secrets.providers.*.command is unsafe.").refine(
    (value) => isAbsolutePath(value),
    "secrets.providers.*.command must be an absolute path."
  ),
  args: z4.array(z4.string().max(1024)).max(128).optional(),
  timeoutMs: z4.number().int().positive().max(12e4).optional(),
  noOutputTimeoutMs: z4.number().int().positive().max(12e4).optional(),
  maxOutputBytes: z4.number().int().positive().max(20 * 1024 * 1024).optional(),
  jsonOnly: z4.boolean().optional(),
  env: z4.record(z4.string(), z4.string()).optional(),
  passEnv: z4.array(z4.string().regex(ENV_SECRET_REF_ID_PATTERN)).max(128).optional(),
  trustedDirs: z4.array(
    z4.string().min(1).refine((value) => isAbsolutePath(value), "trustedDirs entries must be absolute paths.")
  ).max(64).optional(),
  allowInsecurePath: z4.boolean().optional(),
  allowSymlinkCommand: z4.boolean().optional()
}).strict();
var SecretProviderSchema = z4.discriminatedUnion("source", [
  SecretsEnvProviderSchema,
  SecretsFileProviderSchema,
  SecretsExecProviderSchema
]);
var SecretsConfigSchema = z4.object({
  providers: z4.object({
    // Keep this as a record so users can define multiple providers per source.
  }).catchall(SecretProviderSchema).optional(),
  defaults: z4.object({
    env: z4.string().regex(SECRET_PROVIDER_ALIAS_PATTERN).optional(),
    file: z4.string().regex(SECRET_PROVIDER_ALIAS_PATTERN).optional(),
    exec: z4.string().regex(SECRET_PROVIDER_ALIAS_PATTERN).optional()
  }).strict().optional(),
  resolution: z4.object({
    maxProviderConcurrency: z4.number().int().positive().max(16).optional(),
    maxRefsPerProvider: z4.number().int().positive().max(4096).optional(),
    maxBatchBytes: z4.number().int().positive().max(5 * 1024 * 1024).optional()
  }).strict().optional()
}).strict().optional();
var ModelApiSchema = z4.enum(MODEL_APIS);
var ModelCompatSchema = z4.object({
  supportsStore: z4.boolean().optional(),
  supportsDeveloperRole: z4.boolean().optional(),
  supportsReasoningEffort: z4.boolean().optional(),
  supportsUsageInStreaming: z4.boolean().optional(),
  supportsTools: z4.boolean().optional(),
  supportsStrictMode: z4.boolean().optional(),
  maxTokensField: z4.union([z4.literal("max_completion_tokens"), z4.literal("max_tokens")]).optional(),
  thinkingFormat: z4.union([
    z4.literal("openai"),
    z4.literal("openrouter"),
    z4.literal("zai"),
    z4.literal("qwen"),
    z4.literal("qwen-chat-template")
  ]).optional(),
  requiresToolResultName: z4.boolean().optional(),
  requiresAssistantAfterToolResult: z4.boolean().optional(),
  requiresThinkingAsText: z4.boolean().optional(),
  toolSchemaProfile: z4.string().optional(),
  unsupportedToolSchemaKeywords: z4.array(z4.string().min(1)).optional(),
  nativeWebSearchTool: z4.boolean().optional(),
  toolCallArgumentsEncoding: z4.string().optional(),
  requiresMistralToolIds: z4.boolean().optional(),
  requiresOpenAiAnthropicToolPayload: z4.boolean().optional()
}).strict().optional();
var ModelDefinitionSchema = z4.object({
  id: z4.string().min(1),
  name: z4.string().min(1),
  api: ModelApiSchema.optional(),
  reasoning: z4.boolean().optional(),
  input: z4.array(z4.union([z4.literal("text"), z4.literal("image")])).optional(),
  cost: z4.object({
    input: z4.number().optional(),
    output: z4.number().optional(),
    cacheRead: z4.number().optional(),
    cacheWrite: z4.number().optional()
  }).strict().optional(),
  contextWindow: z4.number().positive().optional(),
  maxTokens: z4.number().positive().optional(),
  headers: z4.record(z4.string(), z4.string()).optional(),
  compat: ModelCompatSchema
}).strict();
var ModelProviderSchema = z4.object({
  baseUrl: z4.string().min(1),
  apiKey: SecretInputSchema.optional().register(sensitive),
  auth: z4.union([z4.literal("api-key"), z4.literal("aws-sdk"), z4.literal("oauth"), z4.literal("token")]).optional(),
  api: ModelApiSchema.optional(),
  injectNumCtxForOpenAICompat: z4.boolean().optional(),
  headers: z4.record(z4.string(), SecretInputSchema.register(sensitive)).optional(),
  authHeader: z4.boolean().optional(),
  models: z4.array(ModelDefinitionSchema)
}).strict();
var BedrockDiscoverySchema = z4.object({
  enabled: z4.boolean().optional(),
  region: z4.string().optional(),
  providerFilter: z4.array(z4.string()).optional(),
  refreshInterval: z4.number().int().nonnegative().optional(),
  defaultContextWindow: z4.number().int().positive().optional(),
  defaultMaxTokens: z4.number().int().positive().optional()
}).strict().optional();
var ModelsConfigSchema = z4.object({
  mode: z4.union([z4.literal("merge"), z4.literal("replace")]).optional(),
  providers: z4.record(z4.string(), ModelProviderSchema).optional(),
  bedrockDiscovery: BedrockDiscoverySchema
}).strict().optional();
var GroupChatSchema = z4.object({
  mentionPatterns: z4.array(z4.string()).optional(),
  historyLimit: z4.number().int().positive().optional()
}).strict().optional();
var DmConfigSchema = z4.object({
  historyLimit: z4.number().int().min(0).optional()
}).strict();
var IdentitySchema = z4.object({
  name: z4.string().optional(),
  theme: z4.string().optional(),
  emoji: z4.string().optional(),
  avatar: z4.string().optional()
}).strict().optional();
var QueueModeSchema = z4.union([
  z4.literal("steer"),
  z4.literal("followup"),
  z4.literal("collect"),
  z4.literal("steer-backlog"),
  z4.literal("steer+backlog"),
  z4.literal("queue"),
  z4.literal("interrupt")
]);
var QueueDropSchema = z4.union([
  z4.literal("old"),
  z4.literal("new"),
  z4.literal("summarize")
]);
var ReplyToModeSchema = z4.union([z4.literal("off"), z4.literal("first"), z4.literal("all")]);
var TypingModeSchema = z4.union([
  z4.literal("never"),
  z4.literal("instant"),
  z4.literal("thinking"),
  z4.literal("message")
]);
var GroupPolicySchema = z4.enum(["open", "disabled", "allowlist"]);
var DmPolicySchema = z4.enum(["pairing", "allowlist", "open", "disabled"]);
var BlockStreamingCoalesceSchema = z4.object({
  minChars: z4.number().int().positive().optional(),
  maxChars: z4.number().int().positive().optional(),
  idleMs: z4.number().int().nonnegative().optional()
}).strict();
var ReplyRuntimeConfigSchemaShape = {
  historyLimit: z4.number().int().min(0).optional(),
  dmHistoryLimit: z4.number().int().min(0).optional(),
  dms: z4.record(z4.string(), DmConfigSchema.optional()).optional(),
  textChunkLimit: z4.number().int().positive().optional(),
  chunkMode: z4.enum(["length", "newline"]).optional(),
  blockStreaming: z4.boolean().optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  responsePrefix: z4.string().optional(),
  mediaMaxMb: z4.number().positive().optional()
};
var BlockStreamingChunkSchema = z4.object({
  minChars: z4.number().int().positive().optional(),
  maxChars: z4.number().int().positive().optional(),
  breakPreference: z4.union([z4.literal("paragraph"), z4.literal("newline"), z4.literal("sentence")]).optional()
}).strict();
var MarkdownTableModeSchema = z4.enum(["off", "bullets", "code", "block"]);
var MarkdownConfigSchema = z4.object({
  tables: MarkdownTableModeSchema.optional()
}).strict().optional();
var TtsProviderSchema = z4.string().min(1);
var TtsModeSchema = z4.enum(["final", "all"]);
var TtsAutoSchema = z4.enum(["off", "always", "inbound", "tagged"]);
var TtsProviderConfigSchema = z4.object({
  apiKey: SecretInputSchema.optional().register(sensitive)
}).catchall(
  z4.union([
    z4.string(),
    z4.number(),
    z4.boolean(),
    z4.null(),
    z4.array(z4.unknown()),
    z4.record(z4.string(), z4.unknown())
  ])
);
var TtsConfigSchema = z4.object({
  auto: TtsAutoSchema.optional(),
  enabled: z4.boolean().optional(),
  mode: TtsModeSchema.optional(),
  provider: TtsProviderSchema.optional(),
  summaryModel: z4.string().optional(),
  modelOverrides: z4.object({
    enabled: z4.boolean().optional(),
    allowText: z4.boolean().optional(),
    allowProvider: z4.boolean().optional(),
    allowVoice: z4.boolean().optional(),
    allowModelId: z4.boolean().optional(),
    allowVoiceSettings: z4.boolean().optional(),
    allowNormalization: z4.boolean().optional(),
    allowSeed: z4.boolean().optional()
  }).strict().optional(),
  providers: z4.record(z4.string(), TtsProviderConfigSchema).optional(),
  prefsPath: z4.string().optional(),
  maxTextLength: z4.number().int().min(1).optional(),
  timeoutMs: z4.number().int().min(1e3).max(12e4).optional()
}).strict().optional();
var HumanDelaySchema = z4.object({
  mode: z4.union([z4.literal("off"), z4.literal("natural"), z4.literal("custom")]).optional(),
  minMs: z4.number().int().nonnegative().optional(),
  maxMs: z4.number().int().nonnegative().optional()
}).strict();
var CliBackendWatchdogModeSchema = z4.object({
  noOutputTimeoutMs: z4.number().int().min(1e3).optional(),
  noOutputTimeoutRatio: z4.number().min(0.05).max(0.95).optional(),
  minMs: z4.number().int().min(1e3).optional(),
  maxMs: z4.number().int().min(1e3).optional()
}).strict().optional();
var CliBackendSchema = z4.object({
  command: z4.string(),
  args: z4.array(z4.string()).optional(),
  output: z4.union([z4.literal("json"), z4.literal("text"), z4.literal("jsonl")]).optional(),
  resumeOutput: z4.union([z4.literal("json"), z4.literal("text"), z4.literal("jsonl")]).optional(),
  input: z4.union([z4.literal("arg"), z4.literal("stdin")]).optional(),
  maxPromptArgChars: z4.number().int().positive().optional(),
  env: z4.record(z4.string(), z4.string()).optional(),
  clearEnv: z4.array(z4.string()).optional(),
  modelArg: z4.string().optional(),
  modelAliases: z4.record(z4.string(), z4.string()).optional(),
  sessionArg: z4.string().optional(),
  sessionArgs: z4.array(z4.string()).optional(),
  resumeArgs: z4.array(z4.string()).optional(),
  sessionMode: z4.union([z4.literal("always"), z4.literal("existing"), z4.literal("none")]).optional(),
  sessionIdFields: z4.array(z4.string()).optional(),
  systemPromptArg: z4.string().optional(),
  systemPromptMode: z4.union([z4.literal("append"), z4.literal("replace")]).optional(),
  systemPromptWhen: z4.union([z4.literal("first"), z4.literal("always"), z4.literal("never")]).optional(),
  imageArg: z4.string().optional(),
  imageMode: z4.union([z4.literal("repeat"), z4.literal("list")]).optional(),
  serialize: z4.boolean().optional(),
  reliability: z4.object({
    watchdog: z4.object({
      fresh: CliBackendWatchdogModeSchema,
      resume: CliBackendWatchdogModeSchema
    }).strict().optional()
  }).strict().optional()
}).strict();
var normalizeAllowFrom = (values) => (values ?? []).map((v) => String(v).trim()).filter(Boolean);
var requireOpenAllowFrom = (params) => {
  if (params.policy !== "open") {
    return;
  }
  const allow = normalizeAllowFrom(params.allowFrom);
  if (allow.includes("*")) {
    return;
  }
  params.ctx.addIssue({
    code: z4.ZodIssueCode.custom,
    path: params.path,
    message: params.message
  });
};
var requireAllowlistAllowFrom = (params) => {
  if (params.policy !== "allowlist") {
    return;
  }
  const allow = normalizeAllowFrom(params.allowFrom);
  if (allow.length > 0) {
    return;
  }
  params.ctx.addIssue({
    code: z4.ZodIssueCode.custom,
    path: params.path,
    message: params.message
  });
};
var MSTeamsReplyStyleSchema = z4.enum(["thread", "top-level"]);
var RetryConfigSchema = z4.object({
  attempts: z4.number().int().min(1).optional(),
  minDelayMs: z4.number().int().min(0).optional(),
  maxDelayMs: z4.number().int().min(0).optional(),
  jitter: z4.number().min(0).max(1).optional()
}).strict().optional();
var QueueModeBySurfaceSchema = z4.object({
  whatsapp: QueueModeSchema.optional(),
  telegram: QueueModeSchema.optional(),
  discord: QueueModeSchema.optional(),
  irc: QueueModeSchema.optional(),
  slack: QueueModeSchema.optional(),
  mattermost: QueueModeSchema.optional(),
  signal: QueueModeSchema.optional(),
  imessage: QueueModeSchema.optional(),
  msteams: QueueModeSchema.optional(),
  webchat: QueueModeSchema.optional()
}).strict().optional();
var DebounceMsBySurfaceSchema = z4.record(z4.string(), z4.number().int().nonnegative()).optional();
var QueueSchema = z4.object({
  mode: QueueModeSchema.optional(),
  byChannel: QueueModeBySurfaceSchema,
  debounceMs: z4.number().int().nonnegative().optional(),
  debounceMsByChannel: DebounceMsBySurfaceSchema,
  cap: z4.number().int().positive().optional(),
  drop: QueueDropSchema.optional()
}).strict().optional();
var InboundDebounceSchema = z4.object({
  debounceMs: z4.number().int().nonnegative().optional(),
  byChannel: DebounceMsBySurfaceSchema
}).strict().optional();
var TranscribeAudioSchema = z4.object({
  command: z4.array(z4.string()).superRefine((value, ctx) => {
    const executable = value[0];
    if (!isSafeExecutableValue(executable)) {
      ctx.addIssue({
        code: z4.ZodIssueCode.custom,
        path: [0],
        message: "expected safe executable name or path"
      });
    }
  }),
  timeoutSeconds: z4.number().int().positive().optional()
}).strict().optional();
var HexColorSchema = z4.string().regex(/^#?[0-9a-fA-F]{6}$/, "expected hex color (RRGGBB)");
var ExecutableTokenSchema = z4.string().refine(isSafeExecutableValue, "expected safe executable name or path");
var MediaUnderstandingScopeSchema = createAllowDenyChannelRulesSchema();
var MediaUnderstandingCapabilitiesSchema = z4.array(z4.union([z4.literal("image"), z4.literal("audio"), z4.literal("video")])).optional();
var MediaUnderstandingAttachmentsSchema = z4.object({
  mode: z4.union([z4.literal("first"), z4.literal("all")]).optional(),
  maxAttachments: z4.number().int().positive().optional(),
  prefer: z4.union([z4.literal("first"), z4.literal("last"), z4.literal("path"), z4.literal("url")]).optional()
}).strict().optional();
var DeepgramAudioSchema = z4.object({
  detectLanguage: z4.boolean().optional(),
  punctuate: z4.boolean().optional(),
  smartFormat: z4.boolean().optional()
}).strict().optional();
var ProviderOptionValueSchema = z4.union([z4.string(), z4.number(), z4.boolean()]);
var ProviderOptionsSchema = z4.record(z4.string(), z4.record(z4.string(), ProviderOptionValueSchema)).optional();
var MediaUnderstandingRuntimeFields = {
  prompt: z4.string().optional(),
  timeoutSeconds: z4.number().int().positive().optional(),
  language: z4.string().optional(),
  providerOptions: ProviderOptionsSchema,
  deepgram: DeepgramAudioSchema,
  baseUrl: z4.string().optional(),
  headers: z4.record(z4.string(), z4.string()).optional()
};
var MediaUnderstandingModelSchema = z4.object({
  provider: z4.string().optional(),
  model: z4.string().optional(),
  capabilities: MediaUnderstandingCapabilitiesSchema,
  type: z4.union([z4.literal("provider"), z4.literal("cli")]).optional(),
  command: z4.string().optional(),
  args: z4.array(z4.string()).optional(),
  maxChars: z4.number().int().positive().optional(),
  maxBytes: z4.number().int().positive().optional(),
  ...MediaUnderstandingRuntimeFields,
  profile: z4.string().optional(),
  preferredProfile: z4.string().optional()
}).strict().optional();
var ToolsMediaUnderstandingSchema = z4.object({
  enabled: z4.boolean().optional(),
  scope: MediaUnderstandingScopeSchema,
  maxBytes: z4.number().int().positive().optional(),
  maxChars: z4.number().int().positive().optional(),
  ...MediaUnderstandingRuntimeFields,
  attachments: MediaUnderstandingAttachmentsSchema,
  models: z4.array(MediaUnderstandingModelSchema).optional(),
  echoTranscript: z4.boolean().optional(),
  echoFormat: z4.string().optional()
}).strict().optional();
var ToolsMediaSchema = z4.object({
  models: z4.array(MediaUnderstandingModelSchema).optional(),
  concurrency: z4.number().int().positive().optional(),
  image: ToolsMediaUnderstandingSchema.optional(),
  audio: ToolsMediaUnderstandingSchema.optional(),
  video: ToolsMediaUnderstandingSchema.optional()
}).strict().optional();
var LinkModelSchema = z4.object({
  type: z4.literal("cli").optional(),
  command: z4.string().min(1),
  args: z4.array(z4.string()).optional(),
  timeoutSeconds: z4.number().int().positive().optional()
}).strict();
var ToolsLinksSchema = z4.object({
  enabled: z4.boolean().optional(),
  scope: MediaUnderstandingScopeSchema,
  maxLinks: z4.number().int().positive().optional(),
  timeoutSeconds: z4.number().int().positive().optional(),
  models: z4.array(LinkModelSchema).optional()
}).strict().optional();
var NativeCommandsSettingSchema = z4.union([z4.boolean(), z4.literal("auto")]);
var ProviderCommandsSchema = z4.object({
  native: NativeCommandsSettingSchema.optional(),
  nativeSkills: NativeCommandsSettingSchema.optional()
}).strict().optional();

// vendor/openclaw/src/config/zod-schema.agent-runtime.ts
var HeartbeatSchema = z5.object({
  every: z5.string().optional(),
  activeHours: z5.object({
    start: z5.string().optional(),
    end: z5.string().optional(),
    timezone: z5.string().optional()
  }).strict().optional(),
  model: z5.string().optional(),
  session: z5.string().optional(),
  includeReasoning: z5.boolean().optional(),
  target: z5.string().optional(),
  directPolicy: z5.union([z5.literal("allow"), z5.literal("block")]).optional(),
  to: z5.string().optional(),
  accountId: z5.string().optional(),
  prompt: z5.string().optional(),
  ackMaxChars: z5.number().int().nonnegative().optional(),
  suppressToolErrorWarnings: z5.boolean().optional(),
  lightContext: z5.boolean().optional(),
  isolatedSession: z5.boolean().optional()
}).strict().superRefine((val, ctx) => {
  if (!val.every) {
    return;
  }
  try {
    parseDurationMs(val.every, { defaultUnit: "m" });
  } catch {
    ctx.addIssue({
      code: z5.ZodIssueCode.custom,
      path: ["every"],
      message: "invalid duration (use ms, s, m, h)"
    });
  }
  const active = val.activeHours;
  if (!active) {
    return;
  }
  const timePattern = /^([01]\d|2[0-3]|24):([0-5]\d)$/;
  const validateTime = (raw, opts, path4) => {
    if (!raw) {
      return;
    }
    if (!timePattern.test(raw)) {
      ctx.addIssue({
        code: z5.ZodIssueCode.custom,
        path: ["activeHours", path4],
        message: 'invalid time (use "HH:MM" 24h format)'
      });
      return;
    }
    const [hourStr, minuteStr] = raw.split(":");
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    if (hour === 24 && minute !== 0) {
      ctx.addIssue({
        code: z5.ZodIssueCode.custom,
        path: ["activeHours", path4],
        message: "invalid time (24:00 is the only allowed 24:xx value)"
      });
      return;
    }
    if (hour === 24 && !opts.allow24) {
      ctx.addIssue({
        code: z5.ZodIssueCode.custom,
        path: ["activeHours", path4],
        message: "invalid time (start cannot be 24:00)"
      });
    }
  };
  validateTime(active.start, { allow24: false }, "start");
  validateTime(active.end, { allow24: true }, "end");
}).optional();
var SandboxDockerSchema = z5.object({
  image: z5.string().optional(),
  containerPrefix: z5.string().optional(),
  workdir: z5.string().optional(),
  readOnlyRoot: z5.boolean().optional(),
  tmpfs: z5.array(z5.string()).optional(),
  network: z5.string().optional(),
  user: z5.string().optional(),
  capDrop: z5.array(z5.string()).optional(),
  env: z5.record(z5.string(), z5.string()).optional(),
  setupCommand: z5.union([z5.string(), z5.array(z5.string())]).transform((value) => Array.isArray(value) ? value.join("\n") : value).optional(),
  pidsLimit: z5.number().int().positive().optional(),
  memory: z5.union([z5.string(), z5.number()]).optional(),
  memorySwap: z5.union([z5.string(), z5.number()]).optional(),
  cpus: z5.number().positive().optional(),
  ulimits: z5.record(
    z5.string(),
    z5.union([
      z5.string(),
      z5.number(),
      z5.object({
        soft: z5.number().int().nonnegative().optional(),
        hard: z5.number().int().nonnegative().optional()
      }).strict()
    ])
  ).optional(),
  seccompProfile: z5.string().optional(),
  apparmorProfile: z5.string().optional(),
  dns: z5.array(z5.string()).optional(),
  extraHosts: z5.array(z5.string()).optional(),
  binds: z5.array(z5.string()).optional(),
  dangerouslyAllowReservedContainerTargets: z5.boolean().optional(),
  dangerouslyAllowExternalBindSources: z5.boolean().optional(),
  dangerouslyAllowContainerNamespaceJoin: z5.boolean().optional()
}).strict().superRefine((data, ctx) => {
  if (data.binds) {
    for (let i = 0; i < data.binds.length; i += 1) {
      const bind = data.binds[i]?.trim() ?? "";
      if (!bind) {
        ctx.addIssue({
          code: z5.ZodIssueCode.custom,
          path: ["binds", i],
          message: "Sandbox security: bind mount entry must be a non-empty string."
        });
        continue;
      }
      const firstColon = bind.indexOf(":");
      const source = (firstColon <= 0 ? bind : bind.slice(0, firstColon)).trim();
      if (!source.startsWith("/")) {
        ctx.addIssue({
          code: z5.ZodIssueCode.custom,
          path: ["binds", i],
          message: `Sandbox security: bind mount "${bind}" uses a non-absolute source path "${source}". Only absolute POSIX paths are supported for sandbox binds.`
        });
      }
    }
  }
  const blockedNetworkReason = getBlockedNetworkModeReason({
    network: data.network,
    allowContainerNamespaceJoin: data.dangerouslyAllowContainerNamespaceJoin === true
  });
  if (blockedNetworkReason === "host") {
    ctx.addIssue({
      code: z5.ZodIssueCode.custom,
      path: ["network"],
      message: 'Sandbox security: network mode "host" is blocked. Use "bridge" or "none" instead.'
    });
  }
  if (blockedNetworkReason === "container_namespace_join") {
    ctx.addIssue({
      code: z5.ZodIssueCode.custom,
      path: ["network"],
      message: 'Sandbox security: network mode "container:*" is blocked by default. Use a custom bridge network, or set dangerouslyAllowContainerNamespaceJoin=true only when you fully trust this runtime.'
    });
  }
  if (data.seccompProfile?.trim().toLowerCase() === "unconfined") {
    ctx.addIssue({
      code: z5.ZodIssueCode.custom,
      path: ["seccompProfile"],
      message: 'Sandbox security: seccomp profile "unconfined" is blocked. Use a custom seccomp profile file or omit this setting.'
    });
  }
  if (data.apparmorProfile?.trim().toLowerCase() === "unconfined") {
    ctx.addIssue({
      code: z5.ZodIssueCode.custom,
      path: ["apparmorProfile"],
      message: 'Sandbox security: apparmor profile "unconfined" is blocked. Use a named AppArmor profile or omit this setting.'
    });
  }
}).optional();
var SandboxBrowserSchema = z5.object({
  enabled: z5.boolean().optional(),
  image: z5.string().optional(),
  containerPrefix: z5.string().optional(),
  network: z5.string().optional(),
  cdpPort: z5.number().int().positive().optional(),
  cdpSourceRange: z5.string().optional(),
  vncPort: z5.number().int().positive().optional(),
  noVncPort: z5.number().int().positive().optional(),
  headless: z5.boolean().optional(),
  enableNoVnc: z5.boolean().optional(),
  allowHostControl: z5.boolean().optional(),
  autoStart: z5.boolean().optional(),
  autoStartTimeoutMs: z5.number().int().positive().optional(),
  binds: z5.array(z5.string()).optional()
}).superRefine((data, ctx) => {
  if (data.network?.trim().toLowerCase() === "host") {
    ctx.addIssue({
      code: z5.ZodIssueCode.custom,
      path: ["network"],
      message: 'Sandbox security: browser network mode "host" is blocked. Use "bridge" or a custom bridge network instead.'
    });
  }
}).strict().optional();
var SandboxPruneSchema = z5.object({
  idleHours: z5.number().int().nonnegative().optional(),
  maxAgeDays: z5.number().int().nonnegative().optional()
}).strict().optional();
var ToolPolicyBaseSchema = z5.object({
  allow: z5.array(z5.string()).optional(),
  alsoAllow: z5.array(z5.string()).optional(),
  deny: z5.array(z5.string()).optional()
}).strict();
var ToolPolicySchema = ToolPolicyBaseSchema.superRefine((value, ctx) => {
  if (value.allow && value.allow.length > 0 && value.alsoAllow && value.alsoAllow.length > 0) {
    ctx.addIssue({
      code: z5.ZodIssueCode.custom,
      message: "tools policy cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)"
    });
  }
}).optional();
var TrimmedOptionalConfigStringSchema = z5.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}, z5.string().optional());
var CodexAllowedDomainsSchema = z5.array(z5.string()).transform((values) => {
  const deduped = [
    ...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
  ];
  return deduped.length > 0 ? deduped : void 0;
}).optional();
var CodexUserLocationSchema = z5.object({
  country: TrimmedOptionalConfigStringSchema,
  region: TrimmedOptionalConfigStringSchema,
  city: TrimmedOptionalConfigStringSchema,
  timezone: TrimmedOptionalConfigStringSchema
}).strict().transform((value) => {
  return value.country || value.region || value.city || value.timezone ? value : void 0;
}).optional();
var ToolsWebSearchSchema = z5.object({
  enabled: z5.boolean().optional(),
  provider: z5.string().optional(),
  maxResults: z5.number().int().positive().optional(),
  timeoutSeconds: z5.number().int().positive().optional(),
  cacheTtlMinutes: z5.number().nonnegative().optional(),
  apiKey: SecretInputSchema.optional().register(sensitive),
  openaiCodex: z5.object({
    enabled: z5.boolean().optional(),
    mode: z5.union([z5.literal("cached"), z5.literal("live")]).optional(),
    allowedDomains: CodexAllowedDomainsSchema,
    contextSize: z5.union([z5.literal("low"), z5.literal("medium"), z5.literal("high")]).optional(),
    userLocation: CodexUserLocationSchema
  }).strict().optional()
}).strict().optional();
var ToolsWebFetchSchema = z5.object({
  enabled: z5.boolean().optional(),
  maxChars: z5.number().int().positive().optional(),
  maxCharsCap: z5.number().int().positive().optional(),
  maxResponseBytes: z5.number().int().positive().optional(),
  timeoutSeconds: z5.number().int().positive().optional(),
  cacheTtlMinutes: z5.number().nonnegative().optional(),
  maxRedirects: z5.number().int().nonnegative().optional(),
  userAgent: z5.string().optional(),
  readability: z5.boolean().optional(),
  firecrawl: z5.object({
    enabled: z5.boolean().optional(),
    apiKey: SecretInputSchema.optional().register(sensitive),
    baseUrl: z5.string().optional(),
    onlyMainContent: z5.boolean().optional(),
    maxAgeMs: z5.number().int().nonnegative().optional(),
    timeoutSeconds: z5.number().int().positive().optional()
  }).strict().optional()
}).strict().optional();
var ToolsWebXSearchSchema = z5.object({
  enabled: z5.boolean().optional(),
  apiKey: SecretInputSchema.optional().register(sensitive),
  model: z5.string().optional(),
  inlineCitations: z5.boolean().optional(),
  maxTurns: z5.number().int().optional(),
  timeoutSeconds: z5.number().int().positive().optional(),
  cacheTtlMinutes: z5.number().nonnegative().optional()
}).strict().optional();
var ToolsWebSchema = z5.object({
  search: ToolsWebSearchSchema,
  fetch: ToolsWebFetchSchema,
  x_search: ToolsWebXSearchSchema
}).strict().optional();
var ToolProfileSchema = z5.union([z5.literal("minimal"), z5.literal("coding"), z5.literal("messaging"), z5.literal("full")]).optional();
function addAllowAlsoAllowConflictIssue(value, ctx, message) {
  if (value.allow && value.allow.length > 0 && value.alsoAllow && value.alsoAllow.length > 0) {
    ctx.addIssue({
      code: z5.ZodIssueCode.custom,
      message
    });
  }
}
var ToolPolicyWithProfileSchema = z5.object({
  allow: z5.array(z5.string()).optional(),
  alsoAllow: z5.array(z5.string()).optional(),
  deny: z5.array(z5.string()).optional(),
  profile: ToolProfileSchema
}).strict().superRefine((value, ctx) => {
  addAllowAlsoAllowConflictIssue(
    value,
    ctx,
    "tools.byProvider policy cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)"
  );
});
var ElevatedAllowFromSchema = z5.record(z5.string(), z5.array(z5.union([z5.string(), z5.number()]))).optional();
var ToolExecApplyPatchSchema = z5.object({
  enabled: z5.boolean().optional(),
  workspaceOnly: z5.boolean().optional(),
  allowModels: z5.array(z5.string()).optional()
}).strict().optional();
var ToolExecSafeBinProfileSchema = z5.object({
  minPositional: z5.number().int().nonnegative().optional(),
  maxPositional: z5.number().int().nonnegative().optional(),
  allowedValueFlags: z5.array(z5.string()).optional(),
  deniedFlags: z5.array(z5.string()).optional()
}).strict();
var ToolExecBaseShape = {
  host: z5.enum(["auto", "sandbox", "gateway", "node"]).optional(),
  security: z5.enum(["deny", "allowlist", "full"]).optional(),
  ask: z5.enum(["off", "on-miss", "always"]).optional(),
  node: z5.string().optional(),
  pathPrepend: z5.array(z5.string()).optional(),
  safeBins: z5.array(z5.string()).optional(),
  strictInlineEval: z5.boolean().optional(),
  safeBinTrustedDirs: z5.array(z5.string()).optional(),
  safeBinProfiles: z5.record(z5.string(), ToolExecSafeBinProfileSchema).optional(),
  backgroundMs: z5.number().int().positive().optional(),
  timeoutSec: z5.number().int().positive().optional(),
  cleanupMs: z5.number().int().positive().optional(),
  notifyOnExit: z5.boolean().optional(),
  notifyOnExitEmptySuccess: z5.boolean().optional(),
  applyPatch: ToolExecApplyPatchSchema
};
var AgentToolExecSchema = z5.object({
  ...ToolExecBaseShape,
  approvalRunningNoticeMs: z5.number().int().nonnegative().optional()
}).strict().optional();
var ToolExecSchema = z5.object(ToolExecBaseShape).strict().optional();
var ToolFsSchema = z5.object({
  workspaceOnly: z5.boolean().optional()
}).strict().optional();
var ToolLoopDetectionDetectorSchema = z5.object({
  genericRepeat: z5.boolean().optional(),
  knownPollNoProgress: z5.boolean().optional(),
  pingPong: z5.boolean().optional()
}).strict().optional();
var ToolLoopDetectionSchema = z5.object({
  enabled: z5.boolean().optional(),
  historySize: z5.number().int().positive().optional(),
  warningThreshold: z5.number().int().positive().optional(),
  criticalThreshold: z5.number().int().positive().optional(),
  globalCircuitBreakerThreshold: z5.number().int().positive().optional(),
  detectors: ToolLoopDetectionDetectorSchema
}).strict().superRefine((value, ctx) => {
  if (value.warningThreshold !== void 0 && value.criticalThreshold !== void 0 && value.warningThreshold >= value.criticalThreshold) {
    ctx.addIssue({
      code: z5.ZodIssueCode.custom,
      path: ["criticalThreshold"],
      message: "tools.loopDetection.warningThreshold must be lower than criticalThreshold."
    });
  }
  if (value.criticalThreshold !== void 0 && value.globalCircuitBreakerThreshold !== void 0 && value.criticalThreshold >= value.globalCircuitBreakerThreshold) {
    ctx.addIssue({
      code: z5.ZodIssueCode.custom,
      path: ["globalCircuitBreakerThreshold"],
      message: "tools.loopDetection.criticalThreshold must be lower than globalCircuitBreakerThreshold."
    });
  }
}).optional();
var SandboxSshSchema = z5.object({
  target: z5.string().min(1).optional(),
  command: z5.string().min(1).optional(),
  workspaceRoot: z5.string().min(1).optional(),
  strictHostKeyChecking: z5.boolean().optional(),
  updateHostKeys: z5.boolean().optional(),
  identityFile: z5.string().min(1).optional(),
  certificateFile: z5.string().min(1).optional(),
  knownHostsFile: z5.string().min(1).optional(),
  identityData: SecretInputSchema.optional().register(sensitive),
  certificateData: SecretInputSchema.optional().register(sensitive),
  knownHostsData: SecretInputSchema.optional().register(sensitive)
}).strict().optional();
var AgentSandboxSchema = z5.object({
  mode: z5.union([z5.literal("off"), z5.literal("non-main"), z5.literal("all")]).optional(),
  backend: z5.string().min(1).optional(),
  workspaceAccess: z5.union([z5.literal("none"), z5.literal("ro"), z5.literal("rw")]).optional(),
  sessionToolsVisibility: z5.union([z5.literal("spawned"), z5.literal("all")]).optional(),
  scope: z5.union([z5.literal("session"), z5.literal("agent"), z5.literal("shared")]).optional(),
  perSession: z5.boolean().optional(),
  workspaceRoot: z5.string().optional(),
  docker: SandboxDockerSchema,
  ssh: SandboxSshSchema,
  browser: SandboxBrowserSchema,
  prune: SandboxPruneSchema
}).strict().superRefine((data, ctx) => {
  const blockedBrowserNetworkReason = getBlockedNetworkModeReason({
    network: data.browser?.network,
    allowContainerNamespaceJoin: data.docker?.dangerouslyAllowContainerNamespaceJoin === true
  });
  if (blockedBrowserNetworkReason === "container_namespace_join") {
    ctx.addIssue({
      code: z5.ZodIssueCode.custom,
      path: ["browser", "network"],
      message: 'Sandbox security: browser network mode "container:*" is blocked by default. Set sandbox.docker.dangerouslyAllowContainerNamespaceJoin=true only when you fully trust this runtime.'
    });
  }
}).optional();
var CommonToolPolicyFields = {
  profile: ToolProfileSchema,
  allow: z5.array(z5.string()).optional(),
  alsoAllow: z5.array(z5.string()).optional(),
  deny: z5.array(z5.string()).optional(),
  byProvider: z5.record(z5.string(), ToolPolicyWithProfileSchema).optional()
};
var AgentToolsSchema = z5.object({
  ...CommonToolPolicyFields,
  elevated: z5.object({
    enabled: z5.boolean().optional(),
    allowFrom: ElevatedAllowFromSchema
  }).strict().optional(),
  exec: AgentToolExecSchema,
  fs: ToolFsSchema,
  loopDetection: ToolLoopDetectionSchema,
  sandbox: z5.object({
    tools: ToolPolicySchema
  }).strict().optional()
}).strict().superRefine((value, ctx) => {
  addAllowAlsoAllowConflictIssue(
    value,
    ctx,
    "agent tools cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)"
  );
}).optional();
var MemorySearchSchema = z5.object({
  enabled: z5.boolean().optional(),
  sources: z5.array(z5.union([z5.literal("memory"), z5.literal("sessions")])).optional(),
  extraPaths: z5.array(z5.string()).optional(),
  qmd: z5.object({
    extraCollections: z5.array(
      z5.object({
        path: z5.string(),
        name: z5.string().optional(),
        pattern: z5.string().optional()
      }).strict()
    ).optional()
  }).strict().optional(),
  multimodal: z5.object({
    enabled: z5.boolean().optional(),
    modalities: z5.array(z5.union([z5.literal("image"), z5.literal("audio"), z5.literal("all")])).optional(),
    maxFileBytes: z5.number().int().positive().optional()
  }).strict().optional(),
  experimental: z5.object({
    sessionMemory: z5.boolean().optional()
  }).strict().optional(),
  provider: z5.string().optional(),
  remote: z5.object({
    baseUrl: z5.string().optional(),
    apiKey: SecretInputSchema.optional().register(sensitive),
    headers: z5.record(z5.string(), z5.string()).optional(),
    batch: z5.object({
      enabled: z5.boolean().optional(),
      wait: z5.boolean().optional(),
      concurrency: z5.number().int().positive().optional(),
      pollIntervalMs: z5.number().int().nonnegative().optional(),
      timeoutMinutes: z5.number().int().positive().optional()
    }).strict().optional()
  }).strict().optional(),
  fallback: z5.string().optional(),
  model: z5.string().optional(),
  outputDimensionality: z5.number().int().positive().optional(),
  local: z5.object({
    modelPath: z5.string().optional(),
    modelCacheDir: z5.string().optional()
  }).strict().optional(),
  store: z5.object({
    driver: z5.literal("sqlite").optional(),
    path: z5.string().optional(),
    fts: z5.object({
      tokenizer: z5.union([z5.literal("unicode61"), z5.literal("trigram")]).optional()
    }).strict().optional(),
    vector: z5.object({
      enabled: z5.boolean().optional(),
      extensionPath: z5.string().optional()
    }).strict().optional()
  }).strict().optional(),
  chunking: z5.object({
    tokens: z5.number().int().positive().optional(),
    overlap: z5.number().int().nonnegative().optional()
  }).strict().optional(),
  sync: z5.object({
    onSessionStart: z5.boolean().optional(),
    onSearch: z5.boolean().optional(),
    watch: z5.boolean().optional(),
    watchDebounceMs: z5.number().int().nonnegative().optional(),
    intervalMinutes: z5.number().int().nonnegative().optional(),
    sessions: z5.object({
      deltaBytes: z5.number().int().nonnegative().optional(),
      deltaMessages: z5.number().int().nonnegative().optional(),
      postCompactionForce: z5.boolean().optional()
    }).strict().optional()
  }).strict().optional(),
  query: z5.object({
    maxResults: z5.number().int().positive().optional(),
    minScore: z5.number().min(0).max(1).optional(),
    hybrid: z5.object({
      enabled: z5.boolean().optional(),
      vectorWeight: z5.number().min(0).max(1).optional(),
      textWeight: z5.number().min(0).max(1).optional(),
      candidateMultiplier: z5.number().int().positive().optional(),
      mmr: z5.object({
        enabled: z5.boolean().optional(),
        lambda: z5.number().min(0).max(1).optional()
      }).strict().optional(),
      temporalDecay: z5.object({
        enabled: z5.boolean().optional(),
        halfLifeDays: z5.number().int().positive().optional()
      }).strict().optional()
    }).strict().optional()
  }).strict().optional(),
  cache: z5.object({
    enabled: z5.boolean().optional(),
    maxEntries: z5.number().int().positive().optional()
  }).strict().optional()
}).strict().optional();
var AgentRuntimeAcpSchema = z5.object({
  agent: z5.string().optional(),
  backend: z5.string().optional(),
  mode: z5.enum(["persistent", "oneshot"]).optional(),
  cwd: z5.string().optional()
}).strict().optional();
var AgentRuntimeSchema = z5.union([
  z5.object({
    type: z5.literal("embedded")
  }).strict(),
  z5.object({
    type: z5.literal("acp"),
    acp: AgentRuntimeAcpSchema
  }).strict()
]).optional();
var AgentEntrySchema = z5.object({
  id: z5.string(),
  default: z5.boolean().optional(),
  name: z5.string().optional(),
  workspace: z5.string().optional(),
  agentDir: z5.string().optional(),
  model: AgentModelSchema.optional(),
  thinkingDefault: z5.enum(["off", "minimal", "low", "medium", "high", "xhigh", "adaptive"]).optional(),
  reasoningDefault: z5.enum(["on", "off", "stream"]).optional(),
  fastModeDefault: z5.boolean().optional(),
  skills: z5.array(z5.string()).optional(),
  memorySearch: MemorySearchSchema,
  humanDelay: HumanDelaySchema.optional(),
  heartbeat: HeartbeatSchema,
  identity: IdentitySchema,
  groupChat: GroupChatSchema,
  subagents: z5.object({
    allowAgents: z5.array(z5.string()).optional(),
    model: z5.union([
      z5.string(),
      z5.object({
        primary: z5.string().optional(),
        fallbacks: z5.array(z5.string()).optional()
      }).strict()
    ]).optional(),
    thinking: z5.string().optional(),
    requireAgentId: z5.boolean().optional()
  }).strict().optional(),
  sandbox: AgentSandboxSchema,
  params: z5.record(z5.string(), z5.unknown()).optional(),
  tools: AgentToolsSchema,
  runtime: AgentRuntimeSchema
}).strict();
var ToolsSchema = z5.object({
  ...CommonToolPolicyFields,
  web: ToolsWebSchema,
  media: ToolsMediaSchema,
  links: ToolsLinksSchema,
  sessions: z5.object({
    visibility: z5.enum(["self", "tree", "agent", "all"]).optional()
  }).strict().optional(),
  loopDetection: ToolLoopDetectionSchema,
  message: z5.object({
    allowCrossContextSend: z5.boolean().optional(),
    crossContext: z5.object({
      allowWithinProvider: z5.boolean().optional(),
      allowAcrossProviders: z5.boolean().optional(),
      marker: z5.object({
        enabled: z5.boolean().optional(),
        prefix: z5.string().optional(),
        suffix: z5.string().optional()
      }).strict().optional()
    }).strict().optional(),
    broadcast: z5.object({
      enabled: z5.boolean().optional()
    }).strict().optional()
  }).strict().optional(),
  agentToAgent: z5.object({
    enabled: z5.boolean().optional(),
    allow: z5.array(z5.string()).optional()
  }).strict().optional(),
  elevated: z5.object({
    enabled: z5.boolean().optional(),
    allowFrom: ElevatedAllowFromSchema
  }).strict().optional(),
  exec: ToolExecSchema,
  fs: ToolFsSchema,
  subagents: z5.object({
    tools: ToolPolicySchema
  }).strict().optional(),
  sandbox: z5.object({
    tools: ToolPolicySchema
  }).strict().optional(),
  sessions_spawn: z5.object({
    attachments: z5.object({
      enabled: z5.boolean().optional(),
      maxTotalBytes: z5.number().optional(),
      maxFiles: z5.number().optional(),
      maxFileBytes: z5.number().optional(),
      retainOnSessionKeep: z5.boolean().optional()
    }).strict().optional()
  }).strict().optional()
}).strict().superRefine((value, ctx) => {
  addAllowAlsoAllowConflictIssue(
    value,
    ctx,
    "tools cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)"
  );
}).optional();

// vendor/openclaw/src/config/zod-schema.agents.ts
import { z as z7 } from "zod";

// vendor/openclaw/src/config/zod-schema.agent-defaults.ts
import { z as z6 } from "zod";

// vendor/openclaw/src/config/byte-size.ts
function parseNonNegativeByteSize(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const int = Math.floor(value);
    return int >= 0 ? int : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const bytes = parseByteSize(trimmed, { defaultUnit: "b" });
      return bytes >= 0 ? bytes : null;
    } catch {
      return null;
    }
  }
  return null;
}
function isValidNonNegativeByteSizeString(value) {
  return parseNonNegativeByteSize(value) !== null;
}

// vendor/openclaw/src/config/zod-schema.agent-defaults.ts
var AgentDefaultsSchema = z6.object({
  /** Global default provider params applied to all models before per-model and per-agent overrides. */
  params: z6.record(z6.string(), z6.unknown()).optional(),
  model: AgentModelSchema.optional(),
  imageModel: AgentModelSchema.optional(),
  imageGenerationModel: AgentModelSchema.optional(),
  pdfModel: AgentModelSchema.optional(),
  pdfMaxBytesMb: z6.number().positive().optional(),
  pdfMaxPages: z6.number().int().positive().optional(),
  models: z6.record(
    z6.string(),
    z6.object({
      alias: z6.string().optional(),
      /** Provider-specific API parameters (e.g., GLM-4.7 thinking mode). */
      params: z6.record(z6.string(), z6.unknown()).optional(),
      /** Enable streaming for this model (default: true, false for Ollama to avoid SDK issue #1205). */
      streaming: z6.boolean().optional()
    }).strict()
  ).optional(),
  workspace: z6.string().optional(),
  repoRoot: z6.string().optional(),
  skipBootstrap: z6.boolean().optional(),
  bootstrapMaxChars: z6.number().int().positive().optional(),
  bootstrapTotalMaxChars: z6.number().int().positive().optional(),
  bootstrapPromptTruncationWarning: z6.union([z6.literal("off"), z6.literal("once"), z6.literal("always")]).optional(),
  userTimezone: z6.string().optional(),
  timeFormat: z6.union([z6.literal("auto"), z6.literal("12"), z6.literal("24")]).optional(),
  envelopeTimezone: z6.string().optional(),
  envelopeTimestamp: z6.union([z6.literal("on"), z6.literal("off")]).optional(),
  envelopeElapsed: z6.union([z6.literal("on"), z6.literal("off")]).optional(),
  contextTokens: z6.number().int().positive().optional(),
  cliBackends: z6.record(z6.string(), CliBackendSchema).optional(),
  memorySearch: MemorySearchSchema,
  contextPruning: z6.object({
    mode: z6.union([z6.literal("off"), z6.literal("cache-ttl")]).optional(),
    ttl: z6.string().optional(),
    keepLastAssistants: z6.number().int().nonnegative().optional(),
    softTrimRatio: z6.number().min(0).max(1).optional(),
    hardClearRatio: z6.number().min(0).max(1).optional(),
    minPrunableToolChars: z6.number().int().nonnegative().optional(),
    tools: z6.object({
      allow: z6.array(z6.string()).optional(),
      deny: z6.array(z6.string()).optional()
    }).strict().optional(),
    softTrim: z6.object({
      maxChars: z6.number().int().nonnegative().optional(),
      headChars: z6.number().int().nonnegative().optional(),
      tailChars: z6.number().int().nonnegative().optional()
    }).strict().optional(),
    hardClear: z6.object({
      enabled: z6.boolean().optional(),
      placeholder: z6.string().optional()
    }).strict().optional()
  }).strict().optional(),
  llm: z6.object({
    idleTimeoutSeconds: z6.number().int().nonnegative().optional().describe(
      "Idle timeout for LLM streaming responses in seconds. If no token is received within this time, the request is aborted. Set to 0 to disable. Default: 60 seconds."
    )
  }).strict().optional(),
  compaction: z6.object({
    mode: z6.union([z6.literal("default"), z6.literal("safeguard")]).optional(),
    reserveTokens: z6.number().int().nonnegative().optional(),
    keepRecentTokens: z6.number().int().positive().optional(),
    reserveTokensFloor: z6.number().int().nonnegative().optional(),
    maxHistoryShare: z6.number().min(0.1).max(0.9).optional(),
    customInstructions: z6.string().optional(),
    identifierPolicy: z6.union([z6.literal("strict"), z6.literal("off"), z6.literal("custom")]).optional(),
    identifierInstructions: z6.string().optional(),
    recentTurnsPreserve: z6.number().int().min(0).max(12).optional(),
    qualityGuard: z6.object({
      enabled: z6.boolean().optional(),
      maxRetries: z6.number().int().nonnegative().optional()
    }).strict().optional(),
    postIndexSync: z6.enum(["off", "async", "await"]).optional(),
    postCompactionSections: z6.array(z6.string()).optional(),
    model: z6.string().optional(),
    timeoutSeconds: z6.number().int().positive().optional(),
    memoryFlush: z6.object({
      enabled: z6.boolean().optional(),
      softThresholdTokens: z6.number().int().nonnegative().optional(),
      forceFlushTranscriptBytes: z6.union([
        z6.number().int().nonnegative(),
        z6.string().refine(isValidNonNegativeByteSizeString, "Expected byte size string like 2mb")
      ]).optional(),
      prompt: z6.string().optional(),
      systemPrompt: z6.string().optional()
    }).strict().optional()
  }).strict().optional(),
  embeddedPi: z6.object({
    projectSettingsPolicy: z6.union([z6.literal("trusted"), z6.literal("sanitize"), z6.literal("ignore")]).optional()
  }).strict().optional(),
  thinkingDefault: z6.union([
    z6.literal("off"),
    z6.literal("minimal"),
    z6.literal("low"),
    z6.literal("medium"),
    z6.literal("high"),
    z6.literal("xhigh"),
    z6.literal("adaptive")
  ]).optional(),
  verboseDefault: z6.union([z6.literal("off"), z6.literal("on"), z6.literal("full")]).optional(),
  elevatedDefault: z6.union([z6.literal("off"), z6.literal("on"), z6.literal("ask"), z6.literal("full")]).optional(),
  blockStreamingDefault: z6.union([z6.literal("off"), z6.literal("on")]).optional(),
  blockStreamingBreak: z6.union([z6.literal("text_end"), z6.literal("message_end")]).optional(),
  blockStreamingChunk: BlockStreamingChunkSchema.optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  humanDelay: HumanDelaySchema.optional(),
  timeoutSeconds: z6.number().int().positive().optional(),
  mediaMaxMb: z6.number().positive().optional(),
  imageMaxDimensionPx: z6.number().int().positive().optional(),
  typingIntervalSeconds: z6.number().int().positive().optional(),
  typingMode: TypingModeSchema.optional(),
  heartbeat: HeartbeatSchema,
  maxConcurrent: z6.number().int().positive().optional(),
  subagents: z6.object({
    maxConcurrent: z6.number().int().positive().optional(),
    maxSpawnDepth: z6.number().int().min(1).max(5).optional().describe(
      "Maximum nesting depth for sub-agent spawning. 1 = no nesting (default), 2 = sub-agents can spawn sub-sub-agents."
    ),
    maxChildrenPerAgent: z6.number().int().min(1).max(20).optional().describe(
      "Maximum number of active children a single agent session can spawn (default: 5)."
    ),
    archiveAfterMinutes: z6.number().int().min(0).optional(),
    model: AgentModelSchema.optional(),
    thinking: z6.string().optional(),
    runTimeoutSeconds: z6.number().int().min(0).optional(),
    announceTimeoutMs: z6.number().int().positive().optional(),
    requireAgentId: z6.boolean().optional()
  }).strict().optional(),
  sandbox: AgentSandboxSchema
}).strict().optional();

// vendor/openclaw/src/config/zod-schema.agents.ts
var AgentsSchema = z7.object({
  defaults: z7.lazy(() => AgentDefaultsSchema).optional(),
  list: z7.array(AgentEntrySchema).optional()
}).strict().optional();
var BindingMatchSchema = z7.object({
  channel: z7.string(),
  accountId: z7.string().optional(),
  peer: z7.object({
    kind: z7.union([
      z7.literal("direct"),
      z7.literal("group"),
      z7.literal("channel"),
      /** @deprecated Use `direct` instead. Kept for backward compatibility. */
      z7.literal("dm")
    ]),
    id: z7.string()
  }).strict().optional(),
  guildId: z7.string().optional(),
  teamId: z7.string().optional(),
  roles: z7.array(z7.string()).optional()
}).strict();
var RouteBindingSchema = z7.object({
  type: z7.literal("route").optional(),
  agentId: z7.string(),
  comment: z7.string().optional(),
  match: BindingMatchSchema
}).strict();
var AcpBindingSchema = z7.object({
  type: z7.literal("acp"),
  agentId: z7.string(),
  comment: z7.string().optional(),
  match: BindingMatchSchema,
  acp: z7.object({
    mode: z7.enum(["persistent", "oneshot"]).optional(),
    label: z7.string().optional(),
    cwd: z7.string().optional(),
    backend: z7.string().optional()
  }).strict().optional()
}).strict().superRefine((value, ctx) => {
  const peerId = value.match.peer?.id?.trim() ?? "";
  if (!peerId) {
    ctx.addIssue({
      code: z7.ZodIssueCode.custom,
      path: ["match", "peer"],
      message: "ACP bindings require match.peer.id to target a concrete conversation."
    });
    return;
  }
  const channel = value.match.channel.trim().toLowerCase();
  if (channel !== "discord" && channel !== "telegram" && channel !== "feishu") {
    ctx.addIssue({
      code: z7.ZodIssueCode.custom,
      path: ["match", "channel"],
      message: 'ACP bindings currently support only "discord", "telegram", and "feishu" channels.'
    });
    return;
  }
  if (channel === "telegram" && !/^-\d+:topic:\d+$/.test(peerId)) {
    ctx.addIssue({
      code: z7.ZodIssueCode.custom,
      path: ["match", "peer", "id"],
      message: "Telegram ACP bindings require canonical topic IDs in the form -1001234567890:topic:42."
    });
  }
  if (channel === "feishu") {
    const peerKind = value.match.peer?.kind;
    const isDirectId = (peerKind === "direct" || peerKind === "dm") && /^[^:]+$/.test(peerId) && !peerId.startsWith("oc_") && !peerId.startsWith("on_");
    const isTopicId = peerKind === "group" && /^oc_[^:]+:topic:[^:]+(?::sender:ou_[^:]+)?$/.test(peerId);
    if (!isDirectId && !isTopicId) {
      ctx.addIssue({
        code: z7.ZodIssueCode.custom,
        path: ["match", "peer", "id"],
        message: "Feishu ACP bindings require direct peer IDs for DMs or topic IDs in the form oc_group:topic:om_root[:sender:ou_xxx]."
      });
    }
  }
});
var BindingsSchema = z7.array(z7.union([RouteBindingSchema, AcpBindingSchema])).optional();
var BroadcastStrategySchema = z7.enum(["parallel", "sequential"]);
var BroadcastSchema = z7.object({
  strategy: BroadcastStrategySchema.optional()
}).catchall(z7.array(z7.string())).optional();
var AudioSchema = z7.object({
  transcription: TranscribeAudioSchema
}).strict().optional();

// vendor/openclaw/src/config/zod-schema.approvals.ts
import { z as z8 } from "zod";
var ExecApprovalForwardTargetSchema = z8.object({
  channel: z8.string().min(1),
  to: z8.string().min(1),
  accountId: z8.string().optional(),
  threadId: z8.union([z8.string(), z8.number()]).optional()
}).strict();
var ExecApprovalForwardingSchema = z8.object({
  enabled: z8.boolean().optional(),
  mode: z8.union([z8.literal("session"), z8.literal("targets"), z8.literal("both")]).optional(),
  agentFilter: z8.array(z8.string()).optional(),
  sessionFilter: z8.array(z8.string()).optional(),
  targets: z8.array(ExecApprovalForwardTargetSchema).optional()
}).strict().optional();
var ApprovalsSchema = z8.object({
  exec: ExecApprovalForwardingSchema,
  plugin: ExecApprovalForwardingSchema
}).strict().optional();

// vendor/openclaw/src/config/zod-schema.hooks.ts
import path2 from "node:path";
import { z as z10 } from "zod";

// vendor/openclaw/src/config/zod-schema.installs.ts
import { z as z9 } from "zod";
var InstallSourceSchema = z9.union([
  z9.literal("npm"),
  z9.literal("archive"),
  z9.literal("path"),
  z9.literal("clawhub")
]);
var PluginInstallSourceSchema = z9.union([InstallSourceSchema, z9.literal("marketplace")]);
var InstallRecordShape = {
  source: InstallSourceSchema,
  spec: z9.string().optional(),
  sourcePath: z9.string().optional(),
  installPath: z9.string().optional(),
  version: z9.string().optional(),
  resolvedName: z9.string().optional(),
  resolvedVersion: z9.string().optional(),
  resolvedSpec: z9.string().optional(),
  integrity: z9.string().optional(),
  shasum: z9.string().optional(),
  resolvedAt: z9.string().optional(),
  installedAt: z9.string().optional(),
  clawhubUrl: z9.string().optional(),
  clawhubPackage: z9.string().optional(),
  clawhubFamily: z9.union([z9.literal("code-plugin"), z9.literal("bundle-plugin")]).optional(),
  clawhubChannel: z9.union([z9.literal("official"), z9.literal("community"), z9.literal("private")]).optional()
};
var PluginInstallRecordShape = {
  ...InstallRecordShape,
  source: PluginInstallSourceSchema,
  marketplaceName: z9.string().optional(),
  marketplaceSource: z9.string().optional(),
  marketplacePlugin: z9.string().optional()
};

// vendor/openclaw/src/config/zod-schema.hooks.ts
function isSafeRelativeModulePath(raw) {
  const value = raw.trim();
  if (!value) {
    return false;
  }
  if (path2.isAbsolute(value)) {
    return false;
  }
  if (value.startsWith("~")) {
    return false;
  }
  if (value.includes(":")) {
    return false;
  }
  const parts = value.split(/[\\/]+/g);
  if (parts.some((part) => part === "..")) {
    return false;
  }
  return true;
}
var SafeRelativeModulePathSchema = z10.string().refine(isSafeRelativeModulePath, "module must be a safe relative path (no absolute paths)");
var HookMappingSchema = z10.object({
  id: z10.string().optional(),
  match: z10.object({
    path: z10.string().optional(),
    source: z10.string().optional()
  }).optional(),
  action: z10.union([z10.literal("wake"), z10.literal("agent")]).optional(),
  wakeMode: z10.union([z10.literal("now"), z10.literal("next-heartbeat")]).optional(),
  name: z10.string().optional(),
  agentId: z10.string().optional(),
  sessionKey: z10.string().optional().register(sensitive),
  messageTemplate: z10.string().optional(),
  textTemplate: z10.string().optional(),
  deliver: z10.boolean().optional(),
  allowUnsafeExternalContent: z10.boolean().optional(),
  // Keep this open-ended so runtime channel plugins (for example feishu) can be
  // referenced without hard-coding every channel id in the config schema.
  // Runtime still validates the resolved value against currently registered channels.
  channel: z10.string().trim().min(1).optional(),
  to: z10.string().optional(),
  model: z10.string().optional(),
  thinking: z10.string().optional(),
  timeoutSeconds: z10.number().int().positive().optional(),
  transform: z10.object({
    module: SafeRelativeModulePathSchema,
    export: z10.string().optional()
  }).strict().optional()
}).strict().optional();
var InternalHookHandlerSchema = z10.object({
  event: z10.string(),
  module: SafeRelativeModulePathSchema,
  export: z10.string().optional()
}).strict();
var HookConfigSchema = z10.object({
  enabled: z10.boolean().optional(),
  env: z10.record(z10.string(), z10.string()).optional()
}).passthrough();
var HookInstallRecordSchema = z10.object({
  ...InstallRecordShape,
  hooks: z10.array(z10.string()).optional()
}).strict();
var InternalHooksSchema = z10.object({
  enabled: z10.boolean().optional(),
  handlers: z10.array(InternalHookHandlerSchema).optional(),
  entries: z10.record(z10.string(), HookConfigSchema).optional(),
  load: z10.object({
    extraDirs: z10.array(z10.string()).optional()
  }).strict().optional(),
  installs: z10.record(z10.string(), HookInstallRecordSchema).optional()
}).strict().optional();
var HooksGmailSchema = z10.object({
  account: z10.string().optional(),
  label: z10.string().optional(),
  topic: z10.string().optional(),
  subscription: z10.string().optional(),
  pushToken: z10.string().optional().register(sensitive),
  hookUrl: z10.string().optional(),
  includeBody: z10.boolean().optional(),
  maxBytes: z10.number().int().positive().optional(),
  renewEveryMinutes: z10.number().int().positive().optional(),
  allowUnsafeExternalContent: z10.boolean().optional(),
  serve: z10.object({
    bind: z10.string().optional(),
    port: z10.number().int().positive().optional(),
    path: z10.string().optional()
  }).strict().optional(),
  tailscale: z10.object({
    mode: z10.union([z10.literal("off"), z10.literal("serve"), z10.literal("funnel")]).optional(),
    path: z10.string().optional(),
    target: z10.string().optional()
  }).strict().optional(),
  model: z10.string().optional(),
  thinking: z10.union([
    z10.literal("off"),
    z10.literal("minimal"),
    z10.literal("low"),
    z10.literal("medium"),
    z10.literal("high")
  ]).optional()
}).strict().optional();

// vendor/openclaw/src/config/zod-schema.providers.ts
import { z as z15 } from "zod";

// vendor/openclaw/src/config/zod-schema.channels.ts
import { z as z11 } from "zod";
var ChannelHeartbeatVisibilitySchema = z11.object({
  showOk: z11.boolean().optional(),
  showAlerts: z11.boolean().optional(),
  useIndicator: z11.boolean().optional()
}).strict().optional();
var ChannelHealthMonitorSchema = z11.object({
  enabled: z11.boolean().optional()
}).strict().optional();

// vendor/openclaw/src/config/zod-schema.providers-core.ts
import { z as z13 } from "zod";

// vendor/openclaw/src/infra/scp-host.ts
var SSH_TOKEN = /^[A-Za-z0-9._-]+$/;
var BRACKETED_IPV6 = /^\[[0-9A-Fa-f:.%]+\]$/;
var WHITESPACE = /\s/;
function hasControlOrWhitespace(value) {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127 || WHITESPACE.test(char)) {
      return true;
    }
  }
  return false;
}
function normalizeScpRemoteHost(value) {
  if (typeof value !== "string") {
    return void 0;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return void 0;
  }
  if (hasControlOrWhitespace(trimmed)) {
    return void 0;
  }
  if (trimmed.startsWith("-") || trimmed.includes("/") || trimmed.includes("\\")) {
    return void 0;
  }
  const firstAt = trimmed.indexOf("@");
  const lastAt = trimmed.lastIndexOf("@");
  let user;
  let host = trimmed;
  if (firstAt !== -1) {
    if (firstAt !== lastAt || firstAt === 0 || firstAt === trimmed.length - 1) {
      return void 0;
    }
    user = trimmed.slice(0, firstAt);
    host = trimmed.slice(firstAt + 1);
    if (!SSH_TOKEN.test(user)) {
      return void 0;
    }
  }
  if (!host || host.startsWith("-") || host.includes("@")) {
    return void 0;
  }
  if (host.includes(":") && !BRACKETED_IPV6.test(host)) {
    return void 0;
  }
  if (!SSH_TOKEN.test(host) && !BRACKETED_IPV6.test(host)) {
    return void 0;
  }
  return user ? `${user}@${host}` : host;
}
function isSafeScpRemoteHost(value) {
  return normalizeScpRemoteHost(value) !== void 0;
}

// vendor/openclaw/src/media/inbound-path-policy.ts
import path3 from "node:path";
var WILDCARD_SEGMENT = "*";
var WINDOWS_DRIVE_ABS_RE = /^[A-Za-z]:\//;
var WINDOWS_DRIVE_ROOT_RE = /^[A-Za-z]:$/;
function normalizePosixAbsolutePath(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0")) {
    return void 0;
  }
  const normalized = path3.posix.normalize(trimmed.replaceAll("\\", "/"));
  const isAbsolute = normalized.startsWith("/") || WINDOWS_DRIVE_ABS_RE.test(normalized);
  if (!isAbsolute || normalized === "/") {
    return void 0;
  }
  const withoutTrailingSlash = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  if (WINDOWS_DRIVE_ROOT_RE.test(withoutTrailingSlash)) {
    return void 0;
  }
  return withoutTrailingSlash;
}
function splitPathSegments(value) {
  return value.split("/").filter(Boolean);
}
function isValidInboundPathRootPattern(value) {
  const normalized = normalizePosixAbsolutePath(value);
  if (!normalized) {
    return false;
  }
  const segments = splitPathSegments(normalized);
  if (segments.length === 0) {
    return false;
  }
  return segments.every((segment) => segment === WILDCARD_SEGMENT || !segment.includes("*"));
}

// vendor/openclaw/src/config/discord-preview-streaming.ts
function normalizeStreamingMode(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}
function parseStreamingMode(value) {
  const normalized = normalizeStreamingMode(value);
  if (normalized === "off" || normalized === "partial" || normalized === "block" || normalized === "progress") {
    return normalized;
  }
  return null;
}
function parseDiscordPreviewStreamMode(value) {
  const parsed = parseStreamingMode(value);
  if (!parsed) {
    return null;
  }
  return parsed === "progress" ? "partial" : parsed;
}
function parseSlackLegacyDraftStreamMode(value) {
  const normalized = normalizeStreamingMode(value);
  if (normalized === "replace" || normalized === "status_final" || normalized === "append") {
    return normalized;
  }
  return null;
}
function mapSlackLegacyDraftStreamModeToStreaming(mode) {
  if (mode === "append") {
    return "block";
  }
  if (mode === "status_final") {
    return "progress";
  }
  return "partial";
}
function resolveTelegramPreviewStreamMode(params = {}) {
  const parsedStreaming = parseStreamingMode(params.streaming);
  if (parsedStreaming) {
    if (parsedStreaming === "progress") {
      return "partial";
    }
    return parsedStreaming;
  }
  const legacy = parseDiscordPreviewStreamMode(params.streamMode);
  if (legacy) {
    return legacy;
  }
  if (typeof params.streaming === "boolean") {
    return params.streaming ? "partial" : "off";
  }
  return "partial";
}
function resolveDiscordPreviewStreamMode(params = {}) {
  const parsedStreaming = parseDiscordPreviewStreamMode(params.streaming);
  if (parsedStreaming) {
    return parsedStreaming;
  }
  const legacy = parseDiscordPreviewStreamMode(params.streamMode);
  if (legacy) {
    return legacy;
  }
  if (typeof params.streaming === "boolean") {
    return params.streaming ? "partial" : "off";
  }
  return "off";
}
function resolveSlackStreamingMode(params = {}) {
  const parsedStreaming = parseStreamingMode(params.streaming);
  if (parsedStreaming) {
    return parsedStreaming;
  }
  const legacyStreamMode = parseSlackLegacyDraftStreamMode(params.streamMode);
  if (legacyStreamMode) {
    return mapSlackLegacyDraftStreamModeToStreaming(legacyStreamMode);
  }
  if (typeof params.streaming === "boolean") {
    return params.streaming ? "partial" : "off";
  }
  return "partial";
}
function resolveSlackNativeStreaming(params = {}) {
  if (typeof params.nativeStreaming === "boolean") {
    return params.nativeStreaming;
  }
  if (typeof params.streaming === "boolean") {
    return params.streaming;
  }
  return true;
}

// vendor/openclaw/src/config/telegram-custom-commands.ts
var TELEGRAM_COMMAND_NAME_PATTERN = /^[a-z0-9_]{1,32}$/;
function normalizeTelegramCommandName(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  return withoutSlash.trim().toLowerCase().replace(/-/g, "_");
}
function normalizeTelegramCommandDescription(value) {
  return value.trim();
}
function resolveTelegramCustomCommands(params) {
  const entries = Array.isArray(params.commands) ? params.commands : [];
  const reserved = params.reservedCommands ?? /* @__PURE__ */ new Set();
  const checkReserved = params.checkReserved !== false;
  const checkDuplicates = params.checkDuplicates !== false;
  const seen = /* @__PURE__ */ new Set();
  const resolved = [];
  const issues = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const normalized = normalizeTelegramCommandName(String(entry?.command ?? ""));
    if (!normalized) {
      issues.push({
        index,
        field: "command",
        message: "Telegram custom command is missing a command name."
      });
      continue;
    }
    if (!TELEGRAM_COMMAND_NAME_PATTERN.test(normalized)) {
      issues.push({
        index,
        field: "command",
        message: `Telegram custom command "/${normalized}" is invalid (use a-z, 0-9, underscore; max 32 chars).`
      });
      continue;
    }
    if (checkReserved && reserved.has(normalized)) {
      issues.push({
        index,
        field: "command",
        message: `Telegram custom command "/${normalized}" conflicts with a native command.`
      });
      continue;
    }
    if (checkDuplicates && seen.has(normalized)) {
      issues.push({
        index,
        field: "command",
        message: `Telegram custom command "/${normalized}" is duplicated.`
      });
      continue;
    }
    const description = normalizeTelegramCommandDescription(String(entry?.description ?? ""));
    if (!description) {
      issues.push({
        index,
        field: "description",
        message: `Telegram custom command "/${normalized}" is missing a description.`
      });
      continue;
    }
    if (checkDuplicates) {
      seen.add(normalized);
    }
    resolved.push({ command: normalized, description });
  }
  return { commands: resolved, issues };
}

// vendor/openclaw/src/config/zod-schema.secret-input-validation.ts
import { z as z12 } from "zod";
function forEachEnabledAccount(accounts, run) {
  if (!accounts) {
    return;
  }
  for (const [accountId, account] of Object.entries(accounts)) {
    if (!account || account.enabled === false) {
      continue;
    }
    run(accountId, account);
  }
}
function validateTelegramWebhookSecretRequirements(value, ctx) {
  const baseWebhookUrl = typeof value.webhookUrl === "string" ? value.webhookUrl.trim() : "";
  const hasBaseWebhookSecret = hasConfiguredSecretInput(value.webhookSecret);
  if (baseWebhookUrl && !hasBaseWebhookSecret) {
    ctx.addIssue({
      code: z12.ZodIssueCode.custom,
      message: "channels.telegram.webhookUrl requires channels.telegram.webhookSecret",
      path: ["webhookSecret"]
    });
  }
  forEachEnabledAccount(value.accounts, (accountId, account) => {
    const accountWebhookUrl = typeof account.webhookUrl === "string" ? account.webhookUrl.trim() : "";
    if (!accountWebhookUrl) {
      return;
    }
    const hasAccountSecret = hasConfiguredSecretInput(account.webhookSecret);
    if (!hasAccountSecret && !hasBaseWebhookSecret) {
      ctx.addIssue({
        code: z12.ZodIssueCode.custom,
        message: "channels.telegram.accounts.*.webhookUrl requires channels.telegram.webhookSecret or channels.telegram.accounts.*.webhookSecret",
        path: ["accounts", accountId, "webhookSecret"]
      });
    }
  });
}
function validateSlackSigningSecretRequirements(value, ctx) {
  const baseMode = value.mode === "http" || value.mode === "socket" ? value.mode : "socket";
  if (baseMode === "http" && !hasConfiguredSecretInput(value.signingSecret)) {
    ctx.addIssue({
      code: z12.ZodIssueCode.custom,
      message: 'channels.slack.mode="http" requires channels.slack.signingSecret',
      path: ["signingSecret"]
    });
  }
  forEachEnabledAccount(value.accounts, (accountId, account) => {
    const accountMode = account.mode === "http" || account.mode === "socket" ? account.mode : baseMode;
    if (accountMode !== "http") {
      return;
    }
    const accountSecret = account.signingSecret ?? value.signingSecret;
    if (!hasConfiguredSecretInput(accountSecret)) {
      ctx.addIssue({
        code: z12.ZodIssueCode.custom,
        message: 'channels.slack.accounts.*.mode="http" requires channels.slack.signingSecret or channels.slack.accounts.*.signingSecret',
        path: ["accounts", accountId, "signingSecret"]
      });
    }
  });
}

// vendor/openclaw/src/config/zod-schema.providers-core.ts
var ToolPolicyBySenderSchema = z13.record(z13.string(), ToolPolicySchema).optional();
var DiscordIdSchema = z13.union([z13.string(), z13.number()]).refine((value) => typeof value === "string", {
  message: "Discord IDs must be strings (wrap numeric IDs in quotes)."
});
var DiscordIdListSchema = z13.array(DiscordIdSchema);
var TelegramInlineButtonsScopeSchema = z13.enum(["off", "dm", "group", "all", "allowlist"]);
var TelegramIdListSchema = z13.array(z13.union([z13.string(), z13.number()]));
var TelegramCapabilitiesSchema = z13.union([
  z13.array(z13.string()),
  z13.object({
    inlineButtons: TelegramInlineButtonsScopeSchema.optional()
  }).strict()
]);
var SlackCapabilitiesSchema = z13.union([
  z13.array(z13.string()),
  z13.object({
    interactiveReplies: z13.boolean().optional()
  }).strict()
]);
var TelegramErrorPolicySchema = z13.enum(["always", "once", "silent"]).optional();
var TelegramTopicSchema = z13.object({
  requireMention: z13.boolean().optional(),
  disableAudioPreflight: z13.boolean().optional(),
  groupPolicy: GroupPolicySchema.optional(),
  skills: z13.array(z13.string()).optional(),
  enabled: z13.boolean().optional(),
  allowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  systemPrompt: z13.string().optional(),
  agentId: z13.string().optional(),
  errorPolicy: TelegramErrorPolicySchema,
  errorCooldownMs: z13.number().int().nonnegative().optional()
}).strict();
var TelegramGroupSchema = z13.object({
  requireMention: z13.boolean().optional(),
  disableAudioPreflight: z13.boolean().optional(),
  groupPolicy: GroupPolicySchema.optional(),
  tools: ToolPolicySchema,
  toolsBySender: ToolPolicyBySenderSchema,
  skills: z13.array(z13.string()).optional(),
  enabled: z13.boolean().optional(),
  allowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  systemPrompt: z13.string().optional(),
  topics: z13.record(z13.string(), TelegramTopicSchema.optional()).optional(),
  errorPolicy: TelegramErrorPolicySchema,
  errorCooldownMs: z13.number().int().nonnegative().optional()
}).strict();
var AutoTopicLabelSchema = z13.union([
  z13.boolean(),
  z13.object({
    enabled: z13.boolean().optional(),
    prompt: z13.string().optional()
  }).strict()
]).optional();
var TelegramDirectSchema = z13.object({
  dmPolicy: DmPolicySchema.optional(),
  tools: ToolPolicySchema,
  toolsBySender: ToolPolicyBySenderSchema,
  skills: z13.array(z13.string()).optional(),
  enabled: z13.boolean().optional(),
  allowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  systemPrompt: z13.string().optional(),
  topics: z13.record(z13.string(), TelegramTopicSchema.optional()).optional(),
  errorPolicy: TelegramErrorPolicySchema,
  errorCooldownMs: z13.number().int().nonnegative().optional(),
  requireTopic: z13.boolean().optional(),
  autoTopicLabel: AutoTopicLabelSchema
}).strict();
var TelegramCustomCommandSchema = z13.object({
  command: z13.string().overwrite(normalizeTelegramCommandName),
  description: z13.string().overwrite(normalizeTelegramCommandDescription)
}).strict();
var validateTelegramCustomCommands = (value, ctx) => {
  if (!value.customCommands || value.customCommands.length === 0) {
    return;
  }
  const { issues } = resolveTelegramCustomCommands({
    commands: value.customCommands,
    checkReserved: false,
    checkDuplicates: false
  });
  for (const issue of issues) {
    ctx.addIssue({
      code: z13.ZodIssueCode.custom,
      path: ["customCommands", issue.index, issue.field],
      message: issue.message
    });
  }
};
function normalizeTelegramStreamingConfig(value) {
  value.streaming = resolveTelegramPreviewStreamMode(value);
  delete value.streamMode;
}
function normalizeDiscordStreamingConfig(value) {
  value.streaming = resolveDiscordPreviewStreamMode(value);
  delete value.streamMode;
}
function normalizeSlackStreamingConfig(value) {
  value.nativeStreaming = resolveSlackNativeStreaming(value);
  value.streaming = resolveSlackStreamingMode(value);
  delete value.streamMode;
}
var TelegramAccountSchemaBase = z13.object({
  name: z13.string().optional(),
  capabilities: TelegramCapabilitiesSchema.optional(),
  execApprovals: z13.object({
    enabled: z13.boolean().optional(),
    approvers: TelegramIdListSchema.optional(),
    agentFilter: z13.array(z13.string()).optional(),
    sessionFilter: z13.array(z13.string()).optional(),
    target: z13.enum(["dm", "channel", "both"]).optional()
  }).strict().optional(),
  markdown: MarkdownConfigSchema,
  enabled: z13.boolean().optional(),
  commands: ProviderCommandsSchema,
  customCommands: z13.array(TelegramCustomCommandSchema).optional(),
  configWrites: z13.boolean().optional(),
  dmPolicy: DmPolicySchema.optional().default("pairing"),
  botToken: SecretInputSchema.optional().register(sensitive),
  tokenFile: z13.string().optional(),
  replyToMode: ReplyToModeSchema.optional(),
  groups: z13.record(z13.string(), TelegramGroupSchema.optional()).optional(),
  allowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  defaultTo: z13.union([z13.string(), z13.number()]).optional(),
  groupAllowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  historyLimit: z13.number().int().min(0).optional(),
  dmHistoryLimit: z13.number().int().min(0).optional(),
  dms: z13.record(z13.string(), DmConfigSchema.optional()).optional(),
  direct: z13.record(z13.string(), TelegramDirectSchema.optional()).optional(),
  textChunkLimit: z13.number().int().positive().optional(),
  chunkMode: z13.enum(["length", "newline"]).optional(),
  streaming: z13.union([z13.boolean(), z13.enum(["off", "partial", "block", "progress"])]).optional(),
  blockStreaming: z13.boolean().optional(),
  draftChunk: BlockStreamingChunkSchema.optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  // Legacy key kept for automatic migration to `streaming`.
  streamMode: z13.enum(["off", "partial", "block"]).optional(),
  mediaMaxMb: z13.number().positive().optional(),
  timeoutSeconds: z13.number().int().positive().optional(),
  retry: RetryConfigSchema,
  network: z13.object({
    autoSelectFamily: z13.boolean().optional(),
    dnsResultOrder: z13.enum(["ipv4first", "verbatim"]).optional()
  }).strict().optional(),
  proxy: z13.string().optional(),
  webhookUrl: z13.string().optional().describe(
    "Public HTTPS webhook URL registered with Telegram for inbound updates. This must be internet-reachable and requires channels.telegram.webhookSecret."
  ),
  webhookSecret: SecretInputSchema.optional().describe(
    "Secret token sent to Telegram during webhook registration and verified on inbound webhook requests. Telegram returns this value for verification; this is not the gateway auth token and not the bot token."
  ).register(sensitive),
  webhookPath: z13.string().optional().describe(
    "Local webhook route path served by the gateway listener. Defaults to /telegram-webhook."
  ),
  webhookHost: z13.string().optional().describe(
    "Local bind host for the webhook listener. Defaults to 127.0.0.1; keep loopback unless you intentionally expose direct ingress."
  ),
  webhookPort: z13.number().int().nonnegative().optional().describe(
    "Local bind port for the webhook listener. Defaults to 8787; set to 0 to let the OS assign an ephemeral port."
  ),
  webhookCertPath: z13.string().optional().describe(
    "Path to the self-signed certificate (PEM) to upload to Telegram during webhook registration. Required for self-signed certs (direct IP or no domain)."
  ),
  actions: z13.object({
    reactions: z13.boolean().optional(),
    sendMessage: z13.boolean().optional(),
    poll: z13.boolean().optional(),
    deleteMessage: z13.boolean().optional(),
    editMessage: z13.boolean().optional(),
    sticker: z13.boolean().optional(),
    createForumTopic: z13.boolean().optional(),
    editForumTopic: z13.boolean().optional()
  }).strict().optional(),
  threadBindings: z13.object({
    enabled: z13.boolean().optional(),
    idleHours: z13.number().nonnegative().optional(),
    maxAgeHours: z13.number().nonnegative().optional(),
    spawnSubagentSessions: z13.boolean().optional(),
    spawnAcpSessions: z13.boolean().optional()
  }).strict().optional(),
  reactionNotifications: z13.enum(["off", "own", "all"]).optional(),
  reactionLevel: z13.enum(["off", "ack", "minimal", "extensive"]).optional(),
  heartbeat: ChannelHeartbeatVisibilitySchema,
  healthMonitor: ChannelHealthMonitorSchema,
  linkPreview: z13.boolean().optional(),
  silentErrorReplies: z13.boolean().optional(),
  responsePrefix: z13.string().optional(),
  ackReaction: z13.string().optional(),
  errorPolicy: TelegramErrorPolicySchema,
  errorCooldownMs: z13.number().int().nonnegative().optional(),
  apiRoot: z13.string().url().optional(),
  autoTopicLabel: AutoTopicLabelSchema
}).strict();
var TelegramAccountSchema = TelegramAccountSchemaBase.superRefine((value, ctx) => {
  normalizeTelegramStreamingConfig(value);
  validateTelegramCustomCommands(value, ctx);
});
var TelegramConfigSchema = TelegramAccountSchemaBase.extend({
  accounts: z13.record(z13.string(), TelegramAccountSchema.optional()).optional(),
  defaultAccount: z13.string().optional()
}).superRefine((value, ctx) => {
  normalizeTelegramStreamingConfig(value);
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.telegram.dmPolicy="open" requires channels.telegram.allowFrom to include "*"'
  });
  requireAllowlistAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.telegram.dmPolicy="allowlist" requires channels.telegram.allowFrom to contain at least one sender ID'
  });
  validateTelegramCustomCommands(value, ctx);
  if (value.accounts) {
    for (const [accountId, account] of Object.entries(value.accounts)) {
      if (!account) {
        continue;
      }
      const effectivePolicy = account.dmPolicy ?? value.dmPolicy;
      const effectiveAllowFrom = account.allowFrom ?? value.allowFrom;
      requireOpenAllowFrom({
        policy: effectivePolicy,
        allowFrom: effectiveAllowFrom,
        ctx,
        path: ["accounts", accountId, "allowFrom"],
        message: 'channels.telegram.accounts.*.dmPolicy="open" requires channels.telegram.accounts.*.allowFrom (or channels.telegram.allowFrom) to include "*"'
      });
      requireAllowlistAllowFrom({
        policy: effectivePolicy,
        allowFrom: effectiveAllowFrom,
        ctx,
        path: ["accounts", accountId, "allowFrom"],
        message: 'channels.telegram.accounts.*.dmPolicy="allowlist" requires channels.telegram.accounts.*.allowFrom (or channels.telegram.allowFrom) to contain at least one sender ID'
      });
    }
  }
  if (!value.accounts) {
    validateTelegramWebhookSecretRequirements(value, ctx);
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    if (account.enabled === false) {
      continue;
    }
    const effectiveDmPolicy = account.dmPolicy ?? value.dmPolicy;
    const effectiveAllowFrom = Array.isArray(account.allowFrom) ? account.allowFrom : value.allowFrom;
    requireOpenAllowFrom({
      policy: effectiveDmPolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.telegram.accounts.*.dmPolicy="open" requires channels.telegram.allowFrom or channels.telegram.accounts.*.allowFrom to include "*"'
    });
    requireAllowlistAllowFrom({
      policy: effectiveDmPolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.telegram.accounts.*.dmPolicy="allowlist" requires channels.telegram.allowFrom or channels.telegram.accounts.*.allowFrom to contain at least one sender ID'
    });
  }
  validateTelegramWebhookSecretRequirements(value, ctx);
});
var DiscordDmSchema = z13.object({
  enabled: z13.boolean().optional(),
  policy: DmPolicySchema.optional(),
  allowFrom: DiscordIdListSchema.optional(),
  groupEnabled: z13.boolean().optional(),
  groupChannels: DiscordIdListSchema.optional()
}).strict();
var DiscordGuildChannelSchema = z13.object({
  allow: z13.boolean().optional(),
  requireMention: z13.boolean().optional(),
  ignoreOtherMentions: z13.boolean().optional(),
  tools: ToolPolicySchema,
  toolsBySender: ToolPolicyBySenderSchema,
  skills: z13.array(z13.string()).optional(),
  enabled: z13.boolean().optional(),
  users: DiscordIdListSchema.optional(),
  roles: DiscordIdListSchema.optional(),
  systemPrompt: z13.string().optional(),
  includeThreadStarter: z13.boolean().optional(),
  autoThread: z13.boolean().optional(),
  /** Naming strategy for auto-created threads. "message" uses message text; "generated" creates an LLM title after thread creation. */
  autoThreadName: z13.enum(["message", "generated"]).optional(),
  /** Archive duration for auto-created threads in minutes. Discord supports 60, 1440 (1 day), 4320 (3 days), 10080 (1 week). Default: 60. */
  autoArchiveDuration: z13.union([
    z13.enum(["60", "1440", "4320", "10080"]),
    z13.literal(60),
    z13.literal(1440),
    z13.literal(4320),
    z13.literal(10080)
  ]).optional()
}).strict();
var DiscordGuildSchema = z13.object({
  slug: z13.string().optional(),
  requireMention: z13.boolean().optional(),
  ignoreOtherMentions: z13.boolean().optional(),
  tools: ToolPolicySchema,
  toolsBySender: ToolPolicyBySenderSchema,
  reactionNotifications: z13.enum(["off", "own", "all", "allowlist"]).optional(),
  users: DiscordIdListSchema.optional(),
  roles: DiscordIdListSchema.optional(),
  channels: z13.record(z13.string(), DiscordGuildChannelSchema.optional()).optional()
}).strict();
var DiscordUiSchema = z13.object({
  components: z13.object({
    accentColor: HexColorSchema.optional()
  }).strict().optional()
}).strict().optional();
var DiscordVoiceAutoJoinSchema = z13.object({
  guildId: z13.string().min(1),
  channelId: z13.string().min(1)
}).strict();
var DiscordVoiceSchema = z13.object({
  enabled: z13.boolean().optional(),
  autoJoin: z13.array(DiscordVoiceAutoJoinSchema).optional(),
  daveEncryption: z13.boolean().optional(),
  decryptionFailureTolerance: z13.number().int().min(0).optional(),
  tts: TtsConfigSchema.optional()
}).strict().optional();
var DiscordAccountSchema = z13.object({
  name: z13.string().optional(),
  capabilities: z13.array(z13.string()).optional(),
  markdown: MarkdownConfigSchema,
  enabled: z13.boolean().optional(),
  commands: ProviderCommandsSchema,
  configWrites: z13.boolean().optional(),
  token: SecretInputSchema.optional().register(sensitive),
  proxy: z13.string().optional(),
  allowBots: z13.union([z13.boolean(), z13.literal("mentions")]).optional(),
  dangerouslyAllowNameMatching: z13.boolean().optional(),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  historyLimit: z13.number().int().min(0).optional(),
  dmHistoryLimit: z13.number().int().min(0).optional(),
  dms: z13.record(z13.string(), DmConfigSchema.optional()).optional(),
  textChunkLimit: z13.number().int().positive().optional(),
  chunkMode: z13.enum(["length", "newline"]).optional(),
  blockStreaming: z13.boolean().optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  // Canonical streaming mode. Legacy aliases (`streamMode`, boolean `streaming`) are auto-mapped.
  streaming: z13.union([z13.boolean(), z13.enum(["off", "partial", "block", "progress"])]).optional(),
  streamMode: z13.enum(["partial", "block", "off"]).optional(),
  draftChunk: BlockStreamingChunkSchema.optional(),
  maxLinesPerMessage: z13.number().int().positive().optional(),
  mediaMaxMb: z13.number().positive().optional(),
  retry: RetryConfigSchema,
  actions: z13.object({
    reactions: z13.boolean().optional(),
    stickers: z13.boolean().optional(),
    emojiUploads: z13.boolean().optional(),
    stickerUploads: z13.boolean().optional(),
    polls: z13.boolean().optional(),
    permissions: z13.boolean().optional(),
    messages: z13.boolean().optional(),
    threads: z13.boolean().optional(),
    pins: z13.boolean().optional(),
    search: z13.boolean().optional(),
    memberInfo: z13.boolean().optional(),
    roleInfo: z13.boolean().optional(),
    roles: z13.boolean().optional(),
    channelInfo: z13.boolean().optional(),
    voiceStatus: z13.boolean().optional(),
    events: z13.boolean().optional(),
    moderation: z13.boolean().optional(),
    channels: z13.boolean().optional(),
    presence: z13.boolean().optional()
  }).strict().optional(),
  replyToMode: ReplyToModeSchema.optional(),
  // Aliases for channels.discord.dm.policy / channels.discord.dm.allowFrom. Prefer these for
  // inheritance in multi-account setups (shallow merge works; nested dm object doesn't).
  dmPolicy: DmPolicySchema.optional(),
  allowFrom: DiscordIdListSchema.optional(),
  defaultTo: z13.string().optional(),
  dm: DiscordDmSchema.optional(),
  guilds: z13.record(z13.string(), DiscordGuildSchema.optional()).optional(),
  heartbeat: ChannelHeartbeatVisibilitySchema,
  healthMonitor: ChannelHealthMonitorSchema,
  execApprovals: z13.object({
    enabled: z13.boolean().optional(),
    approvers: DiscordIdListSchema.optional(),
    agentFilter: z13.array(z13.string()).optional(),
    sessionFilter: z13.array(z13.string()).optional(),
    cleanupAfterResolve: z13.boolean().optional(),
    target: z13.enum(["dm", "channel", "both"]).optional()
  }).strict().optional(),
  agentComponents: z13.object({
    enabled: z13.boolean().optional()
  }).strict().optional(),
  ui: DiscordUiSchema,
  slashCommand: z13.object({
    ephemeral: z13.boolean().optional()
  }).strict().optional(),
  threadBindings: z13.object({
    enabled: z13.boolean().optional(),
    idleHours: z13.number().nonnegative().optional(),
    maxAgeHours: z13.number().nonnegative().optional(),
    spawnSubagentSessions: z13.boolean().optional(),
    spawnAcpSessions: z13.boolean().optional()
  }).strict().optional(),
  intents: z13.object({
    presence: z13.boolean().optional(),
    guildMembers: z13.boolean().optional()
  }).strict().optional(),
  voice: DiscordVoiceSchema,
  pluralkit: z13.object({
    enabled: z13.boolean().optional(),
    token: SecretInputSchema.optional().register(sensitive)
  }).strict().optional(),
  responsePrefix: z13.string().optional(),
  ackReaction: z13.string().optional(),
  ackReactionScope: z13.enum(["group-mentions", "group-all", "direct", "all", "off", "none"]).optional(),
  activity: z13.string().optional(),
  status: z13.enum(["online", "dnd", "idle", "invisible"]).optional(),
  autoPresence: z13.object({
    enabled: z13.boolean().optional(),
    intervalMs: z13.number().int().positive().optional(),
    minUpdateIntervalMs: z13.number().int().positive().optional(),
    healthyText: z13.string().optional(),
    degradedText: z13.string().optional(),
    exhaustedText: z13.string().optional()
  }).strict().optional(),
  activityType: z13.union([z13.literal(0), z13.literal(1), z13.literal(2), z13.literal(3), z13.literal(4), z13.literal(5)]).optional(),
  activityUrl: z13.string().url().optional(),
  inboundWorker: z13.object({
    runTimeoutMs: z13.number().int().nonnegative().optional()
  }).strict().optional(),
  eventQueue: z13.object({
    listenerTimeout: z13.number().int().positive().optional(),
    maxQueueSize: z13.number().int().positive().optional(),
    maxConcurrency: z13.number().int().positive().optional()
  }).strict().optional()
}).strict().superRefine((value, ctx) => {
  normalizeDiscordStreamingConfig(value);
  const activityText = typeof value.activity === "string" ? value.activity.trim() : "";
  const hasActivity = Boolean(activityText);
  const hasActivityType = value.activityType !== void 0;
  const activityUrl = typeof value.activityUrl === "string" ? value.activityUrl.trim() : "";
  const hasActivityUrl = Boolean(activityUrl);
  if ((hasActivityType || hasActivityUrl) && !hasActivity) {
    ctx.addIssue({
      code: z13.ZodIssueCode.custom,
      message: "channels.discord.activity is required when activityType or activityUrl is set",
      path: ["activity"]
    });
  }
  if (value.activityType === 1 && !hasActivityUrl) {
    ctx.addIssue({
      code: z13.ZodIssueCode.custom,
      message: "channels.discord.activityUrl is required when activityType is 1 (Streaming)",
      path: ["activityUrl"]
    });
  }
  if (hasActivityUrl && value.activityType !== 1) {
    ctx.addIssue({
      code: z13.ZodIssueCode.custom,
      message: "channels.discord.activityType must be 1 (Streaming) when activityUrl is set",
      path: ["activityType"]
    });
  }
  const autoPresenceInterval = value.autoPresence?.intervalMs;
  const autoPresenceMinUpdate = value.autoPresence?.minUpdateIntervalMs;
  if (typeof autoPresenceInterval === "number" && typeof autoPresenceMinUpdate === "number" && autoPresenceMinUpdate > autoPresenceInterval) {
    ctx.addIssue({
      code: z13.ZodIssueCode.custom,
      message: "channels.discord.autoPresence.minUpdateIntervalMs must be less than or equal to channels.discord.autoPresence.intervalMs",
      path: ["autoPresence", "minUpdateIntervalMs"]
    });
  }
});
var DiscordConfigSchema = DiscordAccountSchema.extend({
  accounts: z13.record(z13.string(), DiscordAccountSchema.optional()).optional(),
  defaultAccount: z13.string().optional()
}).superRefine((value, ctx) => {
  const dmPolicy = value.dmPolicy ?? value.dm?.policy ?? "pairing";
  const allowFrom = value.allowFrom ?? value.dm?.allowFrom;
  const allowFromPath = value.allowFrom !== void 0 ? ["allowFrom"] : ["dm", "allowFrom"];
  requireOpenAllowFrom({
    policy: dmPolicy,
    allowFrom,
    ctx,
    path: [...allowFromPath],
    message: 'channels.discord.dmPolicy="open" requires channels.discord.allowFrom (or channels.discord.dm.allowFrom) to include "*"'
  });
  requireAllowlistAllowFrom({
    policy: dmPolicy,
    allowFrom,
    ctx,
    path: [...allowFromPath],
    message: 'channels.discord.dmPolicy="allowlist" requires channels.discord.allowFrom (or channels.discord.dm.allowFrom) to contain at least one sender ID'
  });
  if (!value.accounts) {
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    const effectivePolicy = account.dmPolicy ?? account.dm?.policy ?? value.dmPolicy ?? value.dm?.policy ?? "pairing";
    const effectiveAllowFrom = account.allowFrom ?? account.dm?.allowFrom ?? value.allowFrom ?? value.dm?.allowFrom;
    requireOpenAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.discord.accounts.*.dmPolicy="open" requires channels.discord.accounts.*.allowFrom (or channels.discord.allowFrom) to include "*"'
    });
    requireAllowlistAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.discord.accounts.*.dmPolicy="allowlist" requires channels.discord.accounts.*.allowFrom (or channels.discord.allowFrom) to contain at least one sender ID'
    });
  }
});
var GoogleChatDmSchema = z13.object({
  enabled: z13.boolean().optional(),
  policy: DmPolicySchema.optional().default("pairing"),
  allowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional()
}).strict().superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.policy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.googlechat.dm.policy="open" requires channels.googlechat.dm.allowFrom to include "*"'
  });
  requireAllowlistAllowFrom({
    policy: value.policy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.googlechat.dm.policy="allowlist" requires channels.googlechat.dm.allowFrom to contain at least one sender ID'
  });
});
var GoogleChatGroupSchema = z13.object({
  enabled: z13.boolean().optional(),
  allow: z13.boolean().optional(),
  requireMention: z13.boolean().optional(),
  users: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  systemPrompt: z13.string().optional()
}).strict();
var GoogleChatAccountSchema = z13.object({
  name: z13.string().optional(),
  capabilities: z13.array(z13.string()).optional(),
  enabled: z13.boolean().optional(),
  configWrites: z13.boolean().optional(),
  allowBots: z13.boolean().optional(),
  dangerouslyAllowNameMatching: z13.boolean().optional(),
  requireMention: z13.boolean().optional(),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  groupAllowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  groups: z13.record(z13.string(), GoogleChatGroupSchema.optional()).optional(),
  defaultTo: z13.string().optional(),
  serviceAccount: z13.union([z13.string(), z13.record(z13.string(), z13.unknown()), SecretRefSchema]).optional().register(sensitive),
  serviceAccountRef: SecretRefSchema.optional().register(sensitive),
  serviceAccountFile: z13.string().optional(),
  audienceType: z13.enum(["app-url", "project-number"]).optional(),
  audience: z13.string().optional(),
  appPrincipal: z13.string().optional(),
  webhookPath: z13.string().optional(),
  webhookUrl: z13.string().optional(),
  botUser: z13.string().optional(),
  historyLimit: z13.number().int().min(0).optional(),
  dmHistoryLimit: z13.number().int().min(0).optional(),
  dms: z13.record(z13.string(), DmConfigSchema.optional()).optional(),
  textChunkLimit: z13.number().int().positive().optional(),
  chunkMode: z13.enum(["length", "newline"]).optional(),
  blockStreaming: z13.boolean().optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  streamMode: z13.enum(["replace", "status_final", "append"]).optional().default("replace"),
  mediaMaxMb: z13.number().positive().optional(),
  replyToMode: ReplyToModeSchema.optional(),
  actions: z13.object({
    reactions: z13.boolean().optional()
  }).strict().optional(),
  dm: GoogleChatDmSchema.optional(),
  healthMonitor: ChannelHealthMonitorSchema,
  typingIndicator: z13.enum(["none", "message", "reaction"]).optional(),
  responsePrefix: z13.string().optional()
}).strict();
var GoogleChatConfigSchema = GoogleChatAccountSchema.extend({
  accounts: z13.record(z13.string(), GoogleChatAccountSchema.optional()).optional(),
  defaultAccount: z13.string().optional()
});
var SlackDmSchema = z13.object({
  enabled: z13.boolean().optional(),
  policy: DmPolicySchema.optional(),
  allowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  groupEnabled: z13.boolean().optional(),
  groupChannels: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  replyToMode: ReplyToModeSchema.optional()
}).strict();
var SlackChannelSchema = z13.object({
  enabled: z13.boolean().optional(),
  allow: z13.boolean().optional(),
  requireMention: z13.boolean().optional(),
  tools: ToolPolicySchema,
  toolsBySender: ToolPolicyBySenderSchema,
  allowBots: z13.boolean().optional(),
  users: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  skills: z13.array(z13.string()).optional(),
  systemPrompt: z13.string().optional()
}).strict();
var SlackThreadSchema = z13.object({
  historyScope: z13.enum(["thread", "channel"]).optional(),
  inheritParent: z13.boolean().optional(),
  initialHistoryLimit: z13.number().int().min(0).optional()
}).strict();
var SlackReplyToModeByChatTypeSchema = z13.object({
  direct: ReplyToModeSchema.optional(),
  group: ReplyToModeSchema.optional(),
  channel: ReplyToModeSchema.optional()
}).strict();
var SlackAccountSchema = z13.object({
  name: z13.string().optional(),
  mode: z13.enum(["socket", "http"]).optional(),
  signingSecret: SecretInputSchema.optional().register(sensitive),
  webhookPath: z13.string().optional(),
  capabilities: SlackCapabilitiesSchema.optional(),
  execApprovals: z13.object({
    enabled: z13.boolean().optional(),
    approvers: z13.array(z13.union([z13.string(), z13.number()])).optional(),
    agentFilter: z13.array(z13.string()).optional(),
    sessionFilter: z13.array(z13.string()).optional(),
    target: z13.enum(["dm", "channel", "both"]).optional()
  }).strict().optional(),
  markdown: MarkdownConfigSchema,
  enabled: z13.boolean().optional(),
  commands: ProviderCommandsSchema,
  configWrites: z13.boolean().optional(),
  botToken: SecretInputSchema.optional().register(sensitive),
  appToken: SecretInputSchema.optional().register(sensitive),
  userToken: SecretInputSchema.optional().register(sensitive),
  userTokenReadOnly: z13.boolean().optional().default(true),
  allowBots: z13.boolean().optional(),
  dangerouslyAllowNameMatching: z13.boolean().optional(),
  requireMention: z13.boolean().optional(),
  groupPolicy: GroupPolicySchema.optional(),
  historyLimit: z13.number().int().min(0).optional(),
  dmHistoryLimit: z13.number().int().min(0).optional(),
  dms: z13.record(z13.string(), DmConfigSchema.optional()).optional(),
  textChunkLimit: z13.number().int().positive().optional(),
  chunkMode: z13.enum(["length", "newline"]).optional(),
  blockStreaming: z13.boolean().optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  streaming: z13.union([z13.boolean(), z13.enum(["off", "partial", "block", "progress"])]).optional(),
  nativeStreaming: z13.boolean().optional(),
  streamMode: z13.enum(["replace", "status_final", "append"]).optional(),
  mediaMaxMb: z13.number().positive().optional(),
  reactionNotifications: z13.enum(["off", "own", "all", "allowlist"]).optional(),
  reactionAllowlist: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  replyToMode: ReplyToModeSchema.optional(),
  replyToModeByChatType: SlackReplyToModeByChatTypeSchema.optional(),
  thread: SlackThreadSchema.optional(),
  actions: z13.object({
    reactions: z13.boolean().optional(),
    messages: z13.boolean().optional(),
    pins: z13.boolean().optional(),
    search: z13.boolean().optional(),
    permissions: z13.boolean().optional(),
    memberInfo: z13.boolean().optional(),
    channelInfo: z13.boolean().optional(),
    emojiList: z13.boolean().optional()
  }).strict().optional(),
  slashCommand: z13.object({
    enabled: z13.boolean().optional(),
    name: z13.string().optional(),
    sessionPrefix: z13.string().optional(),
    ephemeral: z13.boolean().optional()
  }).strict().optional(),
  // Aliases for channels.slack.dm.policy / channels.slack.dm.allowFrom. Prefer these for
  // inheritance in multi-account setups (shallow merge works; nested dm object doesn't).
  dmPolicy: DmPolicySchema.optional(),
  allowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  defaultTo: z13.string().optional(),
  dm: SlackDmSchema.optional(),
  channels: z13.record(z13.string(), SlackChannelSchema.optional()).optional(),
  heartbeat: ChannelHeartbeatVisibilitySchema,
  healthMonitor: ChannelHealthMonitorSchema,
  responsePrefix: z13.string().optional(),
  ackReaction: z13.string().optional(),
  typingReaction: z13.string().optional()
}).strict().superRefine((value) => {
  normalizeSlackStreamingConfig(value);
});
var SlackConfigSchema = SlackAccountSchema.safeExtend({
  mode: z13.enum(["socket", "http"]).optional().default("socket"),
  signingSecret: SecretInputSchema.optional().register(sensitive),
  webhookPath: z13.string().optional().default("/slack/events"),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  accounts: z13.record(z13.string(), SlackAccountSchema.optional()).optional(),
  defaultAccount: z13.string().optional()
}).superRefine((value, ctx) => {
  const dmPolicy = value.dmPolicy ?? value.dm?.policy ?? "pairing";
  const allowFrom = value.allowFrom ?? value.dm?.allowFrom;
  const allowFromPath = value.allowFrom !== void 0 ? ["allowFrom"] : ["dm", "allowFrom"];
  requireOpenAllowFrom({
    policy: dmPolicy,
    allowFrom,
    ctx,
    path: [...allowFromPath],
    message: 'channels.slack.dmPolicy="open" requires channels.slack.allowFrom (or channels.slack.dm.allowFrom) to include "*"'
  });
  requireAllowlistAllowFrom({
    policy: dmPolicy,
    allowFrom,
    ctx,
    path: [...allowFromPath],
    message: 'channels.slack.dmPolicy="allowlist" requires channels.slack.allowFrom (or channels.slack.dm.allowFrom) to contain at least one sender ID'
  });
  const baseMode = value.mode ?? "socket";
  if (!value.accounts) {
    validateSlackSigningSecretRequirements(value, ctx);
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    if (account.enabled === false) {
      continue;
    }
    const accountMode = account.mode ?? baseMode;
    const effectivePolicy = account.dmPolicy ?? account.dm?.policy ?? value.dmPolicy ?? value.dm?.policy ?? "pairing";
    const effectiveAllowFrom = account.allowFrom ?? account.dm?.allowFrom ?? value.allowFrom ?? value.dm?.allowFrom;
    requireOpenAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.slack.accounts.*.dmPolicy="open" requires channels.slack.accounts.*.allowFrom (or channels.slack.allowFrom) to include "*"'
    });
    requireAllowlistAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.slack.accounts.*.dmPolicy="allowlist" requires channels.slack.accounts.*.allowFrom (or channels.slack.allowFrom) to contain at least one sender ID'
    });
    if (accountMode !== "http") {
      continue;
    }
  }
  validateSlackSigningSecretRequirements(value, ctx);
});
var SignalGroupEntrySchema = z13.object({
  requireMention: z13.boolean().optional(),
  tools: ToolPolicySchema,
  toolsBySender: ToolPolicyBySenderSchema
}).strict();
var SignalGroupsSchema = z13.record(z13.string(), SignalGroupEntrySchema.optional()).optional();
var SignalAccountSchemaBase = z13.object({
  name: z13.string().optional(),
  capabilities: z13.array(z13.string()).optional(),
  markdown: MarkdownConfigSchema,
  enabled: z13.boolean().optional(),
  configWrites: z13.boolean().optional(),
  account: z13.string().optional(),
  accountUuid: z13.string().optional(),
  httpUrl: z13.string().optional(),
  httpHost: z13.string().optional(),
  httpPort: z13.number().int().positive().optional(),
  cliPath: ExecutableTokenSchema.optional(),
  autoStart: z13.boolean().optional(),
  startupTimeoutMs: z13.number().int().min(1e3).max(12e4).optional(),
  receiveMode: z13.union([z13.literal("on-start"), z13.literal("manual")]).optional(),
  ignoreAttachments: z13.boolean().optional(),
  ignoreStories: z13.boolean().optional(),
  sendReadReceipts: z13.boolean().optional(),
  dmPolicy: DmPolicySchema.optional().default("pairing"),
  allowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  defaultTo: z13.string().optional(),
  groupAllowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  groups: SignalGroupsSchema,
  historyLimit: z13.number().int().min(0).optional(),
  dmHistoryLimit: z13.number().int().min(0).optional(),
  dms: z13.record(z13.string(), DmConfigSchema.optional()).optional(),
  textChunkLimit: z13.number().int().positive().optional(),
  chunkMode: z13.enum(["length", "newline"]).optional(),
  blockStreaming: z13.boolean().optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  mediaMaxMb: z13.number().int().positive().optional(),
  reactionNotifications: z13.enum(["off", "own", "all", "allowlist"]).optional(),
  reactionAllowlist: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  actions: z13.object({
    reactions: z13.boolean().optional()
  }).strict().optional(),
  reactionLevel: z13.enum(["off", "ack", "minimal", "extensive"]).optional(),
  heartbeat: ChannelHeartbeatVisibilitySchema,
  healthMonitor: ChannelHealthMonitorSchema,
  responsePrefix: z13.string().optional()
}).strict();
var SignalAccountSchema = SignalAccountSchemaBase;
var SignalConfigSchema = SignalAccountSchemaBase.extend({
  accounts: z13.record(z13.string(), SignalAccountSchema.optional()).optional(),
  defaultAccount: z13.string().optional()
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.signal.dmPolicy="open" requires channels.signal.allowFrom to include "*"'
  });
  requireAllowlistAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.signal.dmPolicy="allowlist" requires channels.signal.allowFrom to contain at least one sender ID'
  });
  if (!value.accounts) {
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    const effectivePolicy = account.dmPolicy ?? value.dmPolicy;
    const effectiveAllowFrom = account.allowFrom ?? value.allowFrom;
    requireOpenAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.signal.accounts.*.dmPolicy="open" requires channels.signal.accounts.*.allowFrom (or channels.signal.allowFrom) to include "*"'
    });
    requireAllowlistAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.signal.accounts.*.dmPolicy="allowlist" requires channels.signal.accounts.*.allowFrom (or channels.signal.allowFrom) to contain at least one sender ID'
    });
  }
});
var IrcGroupSchema = z13.object({
  requireMention: z13.boolean().optional(),
  tools: ToolPolicySchema,
  toolsBySender: ToolPolicyBySenderSchema,
  skills: z13.array(z13.string()).optional(),
  enabled: z13.boolean().optional(),
  allowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  systemPrompt: z13.string().optional()
}).strict();
var IrcNickServSchema = z13.object({
  enabled: z13.boolean().optional(),
  service: z13.string().optional(),
  password: SecretInputSchema.optional().register(sensitive),
  passwordFile: z13.string().optional(),
  register: z13.boolean().optional(),
  registerEmail: z13.string().optional()
}).strict();
var IrcAccountSchemaBase = z13.object({
  name: z13.string().optional(),
  capabilities: z13.array(z13.string()).optional(),
  markdown: MarkdownConfigSchema,
  enabled: z13.boolean().optional(),
  configWrites: z13.boolean().optional(),
  host: z13.string().optional(),
  port: z13.number().int().min(1).max(65535).optional(),
  tls: z13.boolean().optional(),
  nick: z13.string().optional(),
  username: z13.string().optional(),
  realname: z13.string().optional(),
  password: SecretInputSchema.optional().register(sensitive),
  passwordFile: z13.string().optional(),
  nickserv: IrcNickServSchema.optional(),
  channels: z13.array(z13.string()).optional(),
  dmPolicy: DmPolicySchema.optional().default("pairing"),
  allowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  defaultTo: z13.string().optional(),
  groupAllowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  groups: z13.record(z13.string(), IrcGroupSchema.optional()).optional(),
  mentionPatterns: z13.array(z13.string()).optional(),
  historyLimit: z13.number().int().min(0).optional(),
  dmHistoryLimit: z13.number().int().min(0).optional(),
  dms: z13.record(z13.string(), DmConfigSchema.optional()).optional(),
  textChunkLimit: z13.number().int().positive().optional(),
  chunkMode: z13.enum(["length", "newline"]).optional(),
  blockStreaming: z13.boolean().optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  mediaMaxMb: z13.number().positive().optional(),
  heartbeat: ChannelHeartbeatVisibilitySchema,
  healthMonitor: ChannelHealthMonitorSchema,
  responsePrefix: z13.string().optional()
}).strict();
function refineIrcAllowFromAndNickserv(value, ctx) {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.irc.dmPolicy="open" requires channels.irc.allowFrom to include "*"'
  });
  requireAllowlistAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.irc.dmPolicy="allowlist" requires channels.irc.allowFrom to contain at least one sender ID'
  });
  if (value.nickserv?.register && !value.nickserv.registerEmail?.trim()) {
    ctx.addIssue({
      code: z13.ZodIssueCode.custom,
      path: ["nickserv", "registerEmail"],
      message: "channels.irc.nickserv.register=true requires channels.irc.nickserv.registerEmail"
    });
  }
}
var IrcAccountSchema = IrcAccountSchemaBase.superRefine((value, ctx) => {
  if (value.nickserv?.register && !value.nickserv.registerEmail?.trim()) {
    ctx.addIssue({
      code: z13.ZodIssueCode.custom,
      path: ["nickserv", "registerEmail"],
      message: "channels.irc.nickserv.register=true requires channels.irc.nickserv.registerEmail"
    });
  }
});
var IrcConfigSchema = IrcAccountSchemaBase.extend({
  accounts: z13.record(z13.string(), IrcAccountSchema.optional()).optional(),
  defaultAccount: z13.string().optional()
}).superRefine((value, ctx) => {
  refineIrcAllowFromAndNickserv(value, ctx);
  if (!value.accounts) {
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    const effectivePolicy = account.dmPolicy ?? value.dmPolicy;
    const effectiveAllowFrom = account.allowFrom ?? value.allowFrom;
    requireOpenAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.irc.accounts.*.dmPolicy="open" requires channels.irc.accounts.*.allowFrom (or channels.irc.allowFrom) to include "*"'
    });
    requireAllowlistAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.irc.accounts.*.dmPolicy="allowlist" requires channels.irc.accounts.*.allowFrom (or channels.irc.allowFrom) to contain at least one sender ID'
    });
  }
});
var IMessageAccountSchemaBase = z13.object({
  name: z13.string().optional(),
  capabilities: z13.array(z13.string()).optional(),
  markdown: MarkdownConfigSchema,
  enabled: z13.boolean().optional(),
  configWrites: z13.boolean().optional(),
  cliPath: ExecutableTokenSchema.optional(),
  dbPath: z13.string().optional(),
  remoteHost: z13.string().refine(isSafeScpRemoteHost, "expected SSH host or user@host (no spaces/options)").optional(),
  service: z13.union([z13.literal("imessage"), z13.literal("sms"), z13.literal("auto")]).optional(),
  region: z13.string().optional(),
  dmPolicy: DmPolicySchema.optional().default("pairing"),
  allowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  defaultTo: z13.string().optional(),
  groupAllowFrom: z13.array(z13.union([z13.string(), z13.number()])).optional(),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  historyLimit: z13.number().int().min(0).optional(),
  dmHistoryLimit: z13.number().int().min(0).optional(),
  dms: z13.record(z13.string(), DmConfigSchema.optional()).optional(),
  includeAttachments: z13.boolean().optional(),
  attachmentRoots: z13.array(z13.string().refine(isValidInboundPathRootPattern, "expected absolute path root")).optional(),
  remoteAttachmentRoots: z13.array(z13.string().refine(isValidInboundPathRootPattern, "expected absolute path root")).optional(),
  mediaMaxMb: z13.number().int().positive().optional(),
  textChunkLimit: z13.number().int().positive().optional(),
  chunkMode: z13.enum(["length", "newline"]).optional(),
  blockStreaming: z13.boolean().optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  groups: z13.record(
    z13.string(),
    z13.object({
      requireMention: z13.boolean().optional(),
      tools: ToolPolicySchema,
      toolsBySender: ToolPolicyBySenderSchema
    }).strict().optional()
  ).optional(),
  heartbeat: ChannelHeartbeatVisibilitySchema,
  healthMonitor: ChannelHealthMonitorSchema,
  responsePrefix: z13.string().optional()
}).strict();
var IMessageAccountSchema = IMessageAccountSchemaBase;
var IMessageConfigSchema = IMessageAccountSchemaBase.extend({
  accounts: z13.record(z13.string(), IMessageAccountSchema.optional()).optional(),
  defaultAccount: z13.string().optional()
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.imessage.dmPolicy="open" requires channels.imessage.allowFrom to include "*"'
  });
  requireAllowlistAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.imessage.dmPolicy="allowlist" requires channels.imessage.allowFrom to contain at least one sender ID'
  });
  if (!value.accounts) {
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    const effectivePolicy = account.dmPolicy ?? value.dmPolicy;
    const effectiveAllowFrom = account.allowFrom ?? value.allowFrom;
    requireOpenAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.imessage.accounts.*.dmPolicy="open" requires channels.imessage.accounts.*.allowFrom (or channels.imessage.allowFrom) to include "*"'
    });
    requireAllowlistAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.imessage.accounts.*.dmPolicy="allowlist" requires channels.imessage.accounts.*.allowFrom (or channels.imessage.allowFrom) to contain at least one sender ID'
    });
  }
});
var BlueBubblesAllowFromEntry = z13.union([z13.string(), z13.number()]);
var BlueBubblesActionSchema = z13.object({
  reactions: z13.boolean().optional(),
  edit: z13.boolean().optional(),
  unsend: z13.boolean().optional(),
  reply: z13.boolean().optional(),
  sendWithEffect: z13.boolean().optional(),
  renameGroup: z13.boolean().optional(),
  setGroupIcon: z13.boolean().optional(),
  addParticipant: z13.boolean().optional(),
  removeParticipant: z13.boolean().optional(),
  leaveGroup: z13.boolean().optional(),
  sendAttachment: z13.boolean().optional()
}).strict().optional();
var BlueBubblesGroupConfigSchema = z13.object({
  requireMention: z13.boolean().optional(),
  tools: ToolPolicySchema,
  toolsBySender: ToolPolicyBySenderSchema
}).strict();
var BlueBubblesAccountSchemaBase = z13.object({
  name: z13.string().optional(),
  capabilities: z13.array(z13.string()).optional(),
  markdown: MarkdownConfigSchema,
  configWrites: z13.boolean().optional(),
  enabled: z13.boolean().optional(),
  serverUrl: z13.string().optional(),
  password: SecretInputSchema.optional().register(sensitive),
  webhookPath: z13.string().optional(),
  dmPolicy: DmPolicySchema.optional().default("pairing"),
  allowFrom: z13.array(BlueBubblesAllowFromEntry).optional(),
  groupAllowFrom: z13.array(BlueBubblesAllowFromEntry).optional(),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  historyLimit: z13.number().int().min(0).optional(),
  dmHistoryLimit: z13.number().int().min(0).optional(),
  dms: z13.record(z13.string(), DmConfigSchema.optional()).optional(),
  textChunkLimit: z13.number().int().positive().optional(),
  chunkMode: z13.enum(["length", "newline"]).optional(),
  mediaMaxMb: z13.number().int().positive().optional(),
  mediaLocalRoots: z13.array(z13.string()).optional(),
  sendReadReceipts: z13.boolean().optional(),
  allowPrivateNetwork: z13.boolean().optional(),
  blockStreaming: z13.boolean().optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  groups: z13.record(z13.string(), BlueBubblesGroupConfigSchema.optional()).optional(),
  heartbeat: ChannelHeartbeatVisibilitySchema,
  healthMonitor: ChannelHealthMonitorSchema,
  responsePrefix: z13.string().optional()
}).strict();
var BlueBubblesAccountSchema = BlueBubblesAccountSchemaBase;
var BlueBubblesConfigSchema = BlueBubblesAccountSchemaBase.extend({
  accounts: z13.record(z13.string(), BlueBubblesAccountSchema.optional()).optional(),
  defaultAccount: z13.string().optional(),
  actions: BlueBubblesActionSchema
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.bluebubbles.dmPolicy="open" requires channels.bluebubbles.allowFrom to include "*"'
  });
  requireAllowlistAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.bluebubbles.dmPolicy="allowlist" requires channels.bluebubbles.allowFrom to contain at least one sender ID'
  });
  if (!value.accounts) {
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    const effectivePolicy = account.dmPolicy ?? value.dmPolicy;
    const effectiveAllowFrom = account.allowFrom ?? value.allowFrom;
    requireOpenAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.bluebubbles.accounts.*.dmPolicy="open" requires channels.bluebubbles.accounts.*.allowFrom (or channels.bluebubbles.allowFrom) to include "*"'
    });
    requireAllowlistAllowFrom({
      policy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.bluebubbles.accounts.*.dmPolicy="allowlist" requires channels.bluebubbles.accounts.*.allowFrom (or channels.bluebubbles.allowFrom) to contain at least one sender ID'
    });
  }
});
var MSTeamsChannelSchema = z13.object({
  requireMention: z13.boolean().optional(),
  tools: ToolPolicySchema,
  toolsBySender: ToolPolicyBySenderSchema,
  replyStyle: MSTeamsReplyStyleSchema.optional()
}).strict();
var MSTeamsTeamSchema = z13.object({
  requireMention: z13.boolean().optional(),
  tools: ToolPolicySchema,
  toolsBySender: ToolPolicyBySenderSchema,
  replyStyle: MSTeamsReplyStyleSchema.optional(),
  channels: z13.record(z13.string(), MSTeamsChannelSchema.optional()).optional()
}).strict();
var MSTeamsConfigSchema = z13.object({
  enabled: z13.boolean().optional(),
  capabilities: z13.array(z13.string()).optional(),
  dangerouslyAllowNameMatching: z13.boolean().optional(),
  markdown: MarkdownConfigSchema,
  configWrites: z13.boolean().optional(),
  appId: z13.string().optional(),
  appPassword: SecretInputSchema.optional().register(sensitive),
  tenantId: z13.string().optional(),
  webhook: z13.object({
    port: z13.number().int().positive().optional(),
    path: z13.string().optional()
  }).strict().optional(),
  dmPolicy: DmPolicySchema.optional().default("pairing"),
  allowFrom: z13.array(z13.string()).optional(),
  defaultTo: z13.string().optional(),
  groupAllowFrom: z13.array(z13.string()).optional(),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  textChunkLimit: z13.number().int().positive().optional(),
  chunkMode: z13.enum(["length", "newline"]).optional(),
  blockStreaming: z13.boolean().optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  mediaAllowHosts: z13.array(z13.string()).optional(),
  mediaAuthAllowHosts: z13.array(z13.string()).optional(),
  requireMention: z13.boolean().optional(),
  historyLimit: z13.number().int().min(0).optional(),
  dmHistoryLimit: z13.number().int().min(0).optional(),
  dms: z13.record(z13.string(), DmConfigSchema.optional()).optional(),
  replyStyle: MSTeamsReplyStyleSchema.optional(),
  teams: z13.record(z13.string(), MSTeamsTeamSchema.optional()).optional(),
  /** Max media size in MB (default: 100MB for OneDrive upload support). */
  mediaMaxMb: z13.number().positive().optional(),
  /** SharePoint site ID for file uploads in group chats/channels (e.g., "contoso.sharepoint.com,guid1,guid2") */
  sharePointSiteId: z13.string().optional(),
  heartbeat: ChannelHeartbeatVisibilitySchema,
  healthMonitor: ChannelHealthMonitorSchema,
  responsePrefix: z13.string().optional(),
  welcomeCard: z13.boolean().optional(),
  promptStarters: z13.array(z13.string()).optional(),
  groupWelcomeCard: z13.boolean().optional(),
  feedbackEnabled: z13.boolean().optional(),
  feedbackReflection: z13.boolean().optional(),
  feedbackReflectionCooldownMs: z13.number().int().min(0).optional()
}).strict().superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.msteams.dmPolicy="open" requires channels.msteams.allowFrom to include "*"'
  });
  requireAllowlistAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message: 'channels.msteams.dmPolicy="allowlist" requires channels.msteams.allowFrom to contain at least one sender ID'
  });
});

// vendor/openclaw/src/config/zod-schema.providers-whatsapp.ts
import { z as z14 } from "zod";
var ToolPolicyBySenderSchema2 = z14.record(z14.string(), ToolPolicySchema).optional();
var WhatsAppGroupEntrySchema = z14.object({
  requireMention: z14.boolean().optional(),
  tools: ToolPolicySchema,
  toolsBySender: ToolPolicyBySenderSchema2
}).strict().optional();
var WhatsAppGroupsSchema = z14.record(z14.string(), WhatsAppGroupEntrySchema).optional();
var WhatsAppAckReactionSchema = z14.object({
  emoji: z14.string().optional(),
  direct: z14.boolean().optional().default(true),
  group: z14.enum(["always", "mentions", "never"]).optional().default("mentions")
}).strict().optional();
var WhatsAppSharedSchema = z14.object({
  enabled: z14.boolean().optional(),
  capabilities: z14.array(z14.string()).optional(),
  markdown: MarkdownConfigSchema,
  configWrites: z14.boolean().optional(),
  sendReadReceipts: z14.boolean().optional(),
  messagePrefix: z14.string().optional(),
  responsePrefix: z14.string().optional(),
  dmPolicy: DmPolicySchema.optional().default("pairing"),
  selfChatMode: z14.boolean().optional(),
  allowFrom: z14.array(z14.string()).optional(),
  defaultTo: z14.string().optional(),
  groupAllowFrom: z14.array(z14.string()).optional(),
  groupPolicy: GroupPolicySchema.optional().default("allowlist"),
  historyLimit: z14.number().int().min(0).optional(),
  dmHistoryLimit: z14.number().int().min(0).optional(),
  dms: z14.record(z14.string(), DmConfigSchema.optional()).optional(),
  textChunkLimit: z14.number().int().positive().optional(),
  chunkMode: z14.enum(["length", "newline"]).optional(),
  blockStreaming: z14.boolean().optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
  groups: WhatsAppGroupsSchema,
  ackReaction: WhatsAppAckReactionSchema,
  reactionLevel: z14.enum(["off", "ack", "minimal", "extensive"]).optional(),
  debounceMs: z14.number().int().nonnegative().optional().default(0),
  heartbeat: ChannelHeartbeatVisibilitySchema,
  healthMonitor: ChannelHealthMonitorSchema
});
function enforceOpenDmPolicyAllowFromStar(params) {
  if (params.dmPolicy !== "open") {
    return;
  }
  const allow = (Array.isArray(params.allowFrom) ? params.allowFrom : []).map((v) => String(v).trim()).filter(Boolean);
  if (allow.includes("*")) {
    return;
  }
  params.ctx.addIssue({
    code: z14.ZodIssueCode.custom,
    path: params.path ?? ["allowFrom"],
    message: params.message
  });
}
function enforceAllowlistDmPolicyAllowFrom(params) {
  if (params.dmPolicy !== "allowlist") {
    return;
  }
  const allow = (Array.isArray(params.allowFrom) ? params.allowFrom : []).map((v) => String(v).trim()).filter(Boolean);
  if (allow.length > 0) {
    return;
  }
  params.ctx.addIssue({
    code: z14.ZodIssueCode.custom,
    path: params.path ?? ["allowFrom"],
    message: params.message
  });
}
var WhatsAppAccountSchema = WhatsAppSharedSchema.extend({
  name: z14.string().optional(),
  enabled: z14.boolean().optional(),
  /** Override auth directory for this WhatsApp account (Baileys multi-file auth state). */
  authDir: z14.string().optional(),
  mediaMaxMb: z14.number().int().positive().optional()
}).strict();
var WhatsAppConfigSchema = WhatsAppSharedSchema.extend({
  accounts: z14.record(z14.string(), WhatsAppAccountSchema.optional()).optional(),
  defaultAccount: z14.string().optional(),
  mediaMaxMb: z14.number().int().positive().optional().default(50),
  actions: z14.object({
    reactions: z14.boolean().optional(),
    sendMessage: z14.boolean().optional(),
    polls: z14.boolean().optional()
  }).strict().optional()
}).strict().superRefine((value, ctx) => {
  enforceOpenDmPolicyAllowFromStar({
    dmPolicy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    message: 'channels.whatsapp.dmPolicy="open" requires channels.whatsapp.allowFrom to include "*"'
  });
  enforceAllowlistDmPolicyAllowFrom({
    dmPolicy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    message: 'channels.whatsapp.dmPolicy="allowlist" requires channels.whatsapp.allowFrom to contain at least one sender ID'
  });
  if (!value.accounts) {
    return;
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!account) {
      continue;
    }
    const effectivePolicy = account.dmPolicy ?? value.dmPolicy;
    const effectiveAllowFrom = account.allowFrom ?? value.allowFrom;
    enforceOpenDmPolicyAllowFromStar({
      dmPolicy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.whatsapp.accounts.*.dmPolicy="open" requires channels.whatsapp.accounts.*.allowFrom (or channels.whatsapp.allowFrom) to include "*"'
    });
    enforceAllowlistDmPolicyAllowFrom({
      dmPolicy: effectivePolicy,
      allowFrom: effectiveAllowFrom,
      ctx,
      path: ["accounts", accountId, "allowFrom"],
      message: 'channels.whatsapp.accounts.*.dmPolicy="allowlist" requires channels.whatsapp.accounts.*.allowFrom (or channels.whatsapp.allowFrom) to contain at least one sender ID'
    });
  }
});

// vendor/openclaw/src/config/zod-schema.providers.ts
var ChannelModelByChannelSchema = z15.record(z15.string(), z15.record(z15.string(), z15.string())).optional();
var directChannelRuntimeSchemas = /* @__PURE__ */ new Map([
  ["bluebubbles", { safeParse: (value) => BlueBubblesConfigSchema.safeParse(value) }],
  ["discord", { safeParse: (value) => DiscordConfigSchema.safeParse(value) }],
  ["googlechat", { safeParse: (value) => GoogleChatConfigSchema.safeParse(value) }],
  ["imessage", { safeParse: (value) => IMessageConfigSchema.safeParse(value) }],
  ["irc", { safeParse: (value) => IrcConfigSchema.safeParse(value) }],
  ["msteams", { safeParse: (value) => MSTeamsConfigSchema.safeParse(value) }],
  ["signal", { safeParse: (value) => SignalConfigSchema.safeParse(value) }],
  ["slack", { safeParse: (value) => SlackConfigSchema.safeParse(value) }],
  ["telegram", { safeParse: (value) => TelegramConfigSchema.safeParse(value) }],
  ["whatsapp", { safeParse: (value) => WhatsAppConfigSchema.safeParse(value) }]
]);
function addLegacyChannelAcpBindingIssues(value, ctx, path4 = []) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => addLegacyChannelAcpBindingIssues(entry, ctx, [...path4, index]));
    return;
  }
  const record = value;
  const bindings = record.bindings;
  if (bindings && typeof bindings === "object" && !Array.isArray(bindings)) {
    const acp = bindings.acp;
    if (acp && typeof acp === "object") {
      ctx.addIssue({
        code: z15.ZodIssueCode.custom,
        path: [...path4, "bindings", "acp"],
        message: "Legacy channel-local ACP bindings were removed; use top-level bindings[] entries."
      });
    }
  }
  for (const [key, entry] of Object.entries(record)) {
    addLegacyChannelAcpBindingIssues(entry, ctx, [...path4, key]);
  }
}
function normalizeBundledChannelConfigs(value, ctx) {
  if (!value) {
    return value;
  }
  let next;
  for (const [channelId, runtimeSchema] of directChannelRuntimeSchemas) {
    if (!Object.prototype.hasOwnProperty.call(value, channelId)) {
      continue;
    }
    const parsed = runtimeSchema.safeParse(value[channelId]);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z15.ZodIssueCode.custom,
          message: issue.message ?? `Invalid channels.${channelId} config.`,
          path: [channelId, ...Array.isArray(issue.path) ? issue.path : []]
        });
      }
      continue;
    }
    next ??= { ...value };
    next[channelId] = parsed.data;
  }
  return next ?? value;
}
var ChannelsSchema = z15.object({
  defaults: z15.object({
    groupPolicy: GroupPolicySchema.optional(),
    heartbeat: ChannelHeartbeatVisibilitySchema
  }).strict().optional(),
  modelByChannel: ChannelModelByChannelSchema
}).passthrough().superRefine((value, ctx) => {
  addLegacyChannelAcpBindingIssues(value, ctx);
}).transform((value, ctx) => normalizeBundledChannelConfigs(value, ctx)).optional();

// vendor/openclaw/src/config/zod-schema.session.ts
import { z as z16 } from "zod";
var SessionResetConfigSchema = z16.object({
  mode: z16.union([z16.literal("daily"), z16.literal("idle")]).optional(),
  atHour: z16.number().int().min(0).max(23).optional(),
  idleMinutes: z16.number().int().positive().optional()
}).strict();
var SessionSendPolicySchema = createAllowDenyChannelRulesSchema();
var SessionSchema = z16.object({
  scope: z16.union([z16.literal("per-sender"), z16.literal("global")]).optional(),
  dmScope: z16.union([
    z16.literal("main"),
    z16.literal("per-peer"),
    z16.literal("per-channel-peer"),
    z16.literal("per-account-channel-peer")
  ]).optional(),
  identityLinks: z16.record(z16.string(), z16.array(z16.string())).optional(),
  resetTriggers: z16.array(z16.string()).optional(),
  idleMinutes: z16.number().int().positive().optional(),
  reset: SessionResetConfigSchema.optional(),
  resetByType: z16.object({
    direct: SessionResetConfigSchema.optional(),
    /** @deprecated Use `direct` instead. Kept for backward compatibility. */
    dm: SessionResetConfigSchema.optional(),
    group: SessionResetConfigSchema.optional(),
    thread: SessionResetConfigSchema.optional()
  }).strict().optional(),
  resetByChannel: z16.record(z16.string(), SessionResetConfigSchema).optional(),
  store: z16.string().optional(),
  typingIntervalSeconds: z16.number().int().positive().optional(),
  typingMode: TypingModeSchema.optional(),
  parentForkMaxTokens: z16.number().int().nonnegative().optional(),
  mainKey: z16.string().optional(),
  sendPolicy: SessionSendPolicySchema.optional(),
  agentToAgent: z16.object({
    maxPingPongTurns: z16.number().int().min(0).max(5).optional()
  }).strict().optional(),
  threadBindings: z16.object({
    enabled: z16.boolean().optional(),
    idleHours: z16.number().nonnegative().optional(),
    maxAgeHours: z16.number().nonnegative().optional()
  }).strict().optional(),
  maintenance: z16.object({
    mode: z16.enum(["enforce", "warn"]).optional(),
    pruneAfter: z16.union([z16.string(), z16.number()]).optional(),
    /** @deprecated Use pruneAfter instead. */
    pruneDays: z16.number().int().positive().optional(),
    maxEntries: z16.number().int().positive().optional(),
    rotateBytes: z16.union([z16.string(), z16.number()]).optional(),
    resetArchiveRetention: z16.union([z16.string(), z16.number(), z16.literal(false)]).optional(),
    maxDiskBytes: z16.union([z16.string(), z16.number()]).optional(),
    highWaterBytes: z16.union([z16.string(), z16.number()]).optional()
  }).strict().superRefine((val, ctx) => {
    if (val.pruneAfter !== void 0) {
      try {
        parseDurationMs(String(val.pruneAfter).trim(), { defaultUnit: "d" });
      } catch {
        ctx.addIssue({
          code: z16.ZodIssueCode.custom,
          path: ["pruneAfter"],
          message: "invalid duration (use ms, s, m, h, d)"
        });
      }
    }
    if (val.rotateBytes !== void 0) {
      try {
        parseByteSize(String(val.rotateBytes).trim(), { defaultUnit: "b" });
      } catch {
        ctx.addIssue({
          code: z16.ZodIssueCode.custom,
          path: ["rotateBytes"],
          message: "invalid size (use b, kb, mb, gb, tb)"
        });
      }
    }
    if (val.resetArchiveRetention !== void 0 && val.resetArchiveRetention !== false) {
      try {
        parseDurationMs(String(val.resetArchiveRetention).trim(), { defaultUnit: "d" });
      } catch {
        ctx.addIssue({
          code: z16.ZodIssueCode.custom,
          path: ["resetArchiveRetention"],
          message: "invalid duration (use ms, s, m, h, d)"
        });
      }
    }
    if (val.maxDiskBytes !== void 0) {
      try {
        parseByteSize(String(val.maxDiskBytes).trim(), { defaultUnit: "b" });
      } catch {
        ctx.addIssue({
          code: z16.ZodIssueCode.custom,
          path: ["maxDiskBytes"],
          message: "invalid size (use b, kb, mb, gb, tb)"
        });
      }
    }
    if (val.highWaterBytes !== void 0) {
      try {
        parseByteSize(String(val.highWaterBytes).trim(), { defaultUnit: "b" });
      } catch {
        ctx.addIssue({
          code: z16.ZodIssueCode.custom,
          path: ["highWaterBytes"],
          message: "invalid size (use b, kb, mb, gb, tb)"
        });
      }
    }
  }).optional()
}).strict().optional();
var MessagesSchema = z16.object({
  messagePrefix: z16.string().optional(),
  responsePrefix: z16.string().optional(),
  groupChat: GroupChatSchema,
  queue: QueueSchema,
  inbound: InboundDebounceSchema,
  ackReaction: z16.string().optional(),
  ackReactionScope: z16.enum(["group-mentions", "group-all", "direct", "all", "off", "none"]).optional(),
  removeAckAfterReply: z16.boolean().optional(),
  statusReactions: z16.object({
    enabled: z16.boolean().optional(),
    emojis: z16.object({
      thinking: z16.string().optional(),
      tool: z16.string().optional(),
      coding: z16.string().optional(),
      web: z16.string().optional(),
      done: z16.string().optional(),
      error: z16.string().optional(),
      stallSoft: z16.string().optional(),
      stallHard: z16.string().optional(),
      compacting: z16.string().optional()
    }).strict().optional(),
    timing: z16.object({
      debounceMs: z16.number().int().min(0).optional(),
      stallSoftMs: z16.number().int().min(0).optional(),
      stallHardMs: z16.number().int().min(0).optional(),
      doneHoldMs: z16.number().int().min(0).optional(),
      errorHoldMs: z16.number().int().min(0).optional()
    }).strict().optional()
  }).strict().optional(),
  suppressToolErrors: z16.boolean().optional(),
  tts: TtsConfigSchema
}).strict().optional();
var CommandsSchema = z16.object({
  native: NativeCommandsSettingSchema.optional().default("auto"),
  nativeSkills: NativeCommandsSettingSchema.optional().default("auto"),
  text: z16.boolean().optional(),
  bash: z16.boolean().optional(),
  bashForegroundMs: z16.number().int().min(0).max(3e4).optional(),
  config: z16.boolean().optional(),
  mcp: z16.boolean().optional(),
  plugins: z16.boolean().optional(),
  debug: z16.boolean().optional(),
  restart: z16.boolean().optional().default(true),
  useAccessGroups: z16.boolean().optional(),
  ownerAllowFrom: z16.array(z16.union([z16.string(), z16.number()])).optional(),
  ownerDisplay: z16.enum(["raw", "hash"]).optional().default("raw"),
  ownerDisplaySecret: z16.string().optional().register(sensitive),
  allowFrom: ElevatedAllowFromSchema.optional()
}).strict().optional().default(
  () => ({ native: "auto", nativeSkills: "auto", restart: true, ownerDisplay: "raw" })
);

// vendor/openclaw/src/config/zod-schema.ts
var BrowserSnapshotDefaultsSchema = z17.object({
  mode: z17.literal("efficient").optional()
}).strict().optional();
var NodeHostSchema = z17.object({
  browserProxy: z17.object({
    enabled: z17.boolean().optional(),
    allowProfiles: z17.array(z17.string()).optional()
  }).strict().optional()
}).strict().optional();
var MemoryQmdPathSchema = z17.object({
  path: z17.string(),
  name: z17.string().optional(),
  pattern: z17.string().optional()
}).strict();
var MemoryQmdSessionSchema = z17.object({
  enabled: z17.boolean().optional(),
  exportDir: z17.string().optional(),
  retentionDays: z17.number().int().nonnegative().optional()
}).strict();
var MemoryQmdUpdateSchema = z17.object({
  interval: z17.string().optional(),
  debounceMs: z17.number().int().nonnegative().optional(),
  onBoot: z17.boolean().optional(),
  waitForBootSync: z17.boolean().optional(),
  embedInterval: z17.string().optional(),
  commandTimeoutMs: z17.number().int().nonnegative().optional(),
  updateTimeoutMs: z17.number().int().nonnegative().optional(),
  embedTimeoutMs: z17.number().int().nonnegative().optional()
}).strict();
var MemoryQmdLimitsSchema = z17.object({
  maxResults: z17.number().int().positive().optional(),
  maxSnippetChars: z17.number().int().positive().optional(),
  maxInjectedChars: z17.number().int().positive().optional(),
  timeoutMs: z17.number().int().nonnegative().optional()
}).strict();
var MemoryQmdMcporterSchema = z17.object({
  enabled: z17.boolean().optional(),
  serverName: z17.string().optional(),
  startDaemon: z17.boolean().optional()
}).strict();
var LoggingLevelSchema = z17.union([
  z17.literal("silent"),
  z17.literal("fatal"),
  z17.literal("error"),
  z17.literal("warn"),
  z17.literal("info"),
  z17.literal("debug"),
  z17.literal("trace")
]);
var MemoryQmdSchema = z17.object({
  command: z17.string().optional(),
  mcporter: MemoryQmdMcporterSchema.optional(),
  searchMode: z17.union([z17.literal("query"), z17.literal("search"), z17.literal("vsearch")]).optional(),
  searchTool: z17.string().trim().min(1).optional(),
  includeDefaultMemory: z17.boolean().optional(),
  paths: z17.array(MemoryQmdPathSchema).optional(),
  sessions: MemoryQmdSessionSchema.optional(),
  update: MemoryQmdUpdateSchema.optional(),
  limits: MemoryQmdLimitsSchema.optional(),
  scope: SessionSendPolicySchema.optional()
}).strict();
var MemorySchema = z17.object({
  backend: z17.union([z17.literal("builtin"), z17.literal("qmd")]).optional(),
  citations: z17.union([z17.literal("auto"), z17.literal("on"), z17.literal("off")]).optional(),
  qmd: MemoryQmdSchema.optional()
}).strict().optional();
var HttpUrlSchema = z17.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Expected http:// or https:// URL");
var ResponsesEndpointUrlFetchShape = {
  allowUrl: z17.boolean().optional(),
  urlAllowlist: z17.array(z17.string()).optional(),
  allowedMimes: z17.array(z17.string()).optional(),
  maxBytes: z17.number().int().positive().optional(),
  maxRedirects: z17.number().int().nonnegative().optional(),
  timeoutMs: z17.number().int().positive().optional()
};
var SkillEntrySchema = z17.object({
  enabled: z17.boolean().optional(),
  apiKey: SecretInputSchema.optional().register(sensitive),
  env: z17.record(z17.string(), z17.string()).optional(),
  config: z17.record(z17.string(), z17.unknown()).optional()
}).strict();
var PluginEntrySchema = z17.object({
  enabled: z17.boolean().optional(),
  hooks: z17.object({
    allowPromptInjection: z17.boolean().optional()
  }).strict().optional(),
  subagent: z17.object({
    allowModelOverride: z17.boolean().optional(),
    allowedModels: z17.array(z17.string()).optional()
  }).strict().optional(),
  config: z17.record(z17.string(), z17.unknown()).optional()
}).strict();
var TalkProviderEntrySchema = z17.object({
  voiceId: z17.string().optional(),
  voiceAliases: z17.record(z17.string(), z17.string()).optional(),
  modelId: z17.string().optional(),
  outputFormat: z17.string().optional(),
  apiKey: SecretInputSchema.optional().register(sensitive)
}).catchall(z17.unknown());
var TalkSchema = z17.object({
  provider: z17.string().optional(),
  providers: z17.record(z17.string(), TalkProviderEntrySchema).optional(),
  voiceId: z17.string().optional(),
  voiceAliases: z17.record(z17.string(), z17.string()).optional(),
  modelId: z17.string().optional(),
  outputFormat: z17.string().optional(),
  apiKey: SecretInputSchema.optional().register(sensitive),
  interruptOnSpeech: z17.boolean().optional(),
  silenceTimeoutMs: z17.number().int().positive().optional()
}).strict().superRefine((talk, ctx) => {
  const provider = talk.provider?.trim().toLowerCase();
  const providers = talk.providers ? Object.keys(talk.providers) : [];
  if (provider && providers.length > 0 && !(provider in talk.providers)) {
    ctx.addIssue({
      code: z17.ZodIssueCode.custom,
      path: ["provider"],
      message: `talk.provider must match a key in talk.providers (missing "${provider}")`
    });
  }
  if (!provider && providers.length > 1) {
    ctx.addIssue({
      code: z17.ZodIssueCode.custom,
      path: ["provider"],
      message: "talk.provider is required when talk.providers defines multiple providers"
    });
  }
});
var McpServerSchema = z17.object({
  command: z17.string().optional(),
  args: z17.array(z17.string()).optional(),
  env: z17.record(z17.string(), z17.union([z17.string(), z17.number(), z17.boolean()])).optional(),
  cwd: z17.string().optional(),
  workingDirectory: z17.string().optional(),
  url: HttpUrlSchema.optional(),
  headers: z17.record(
    z17.string(),
    z17.union([z17.string().register(sensitive), z17.number(), z17.boolean()]).register(sensitive)
  ).optional()
}).catchall(z17.unknown());
var McpConfigSchema = z17.object({
  servers: z17.record(z17.string(), McpServerSchema).optional()
}).strict().optional();
var OpenClawSchema = z17.object({
  $schema: z17.string().optional(),
  meta: z17.object({
    lastTouchedVersion: z17.string().optional(),
    // Accept any string unchanged (backwards-compatible) and coerce numeric Unix
    // timestamps to ISO strings (agent file edits may write Date.now()).
    lastTouchedAt: z17.union([
      z17.string(),
      z17.number().transform((n, ctx) => {
        const d = new Date(n);
        if (Number.isNaN(d.getTime())) {
          ctx.addIssue({ code: z17.ZodIssueCode.custom, message: "Invalid timestamp" });
          return z17.NEVER;
        }
        return d.toISOString();
      })
    ]).optional()
  }).strict().optional(),
  env: z17.object({
    shellEnv: z17.object({
      enabled: z17.boolean().optional(),
      timeoutMs: z17.number().int().nonnegative().optional()
    }).strict().optional(),
    vars: z17.record(z17.string(), z17.string()).optional()
  }).catchall(z17.string()).optional(),
  wizard: z17.object({
    lastRunAt: z17.string().optional(),
    lastRunVersion: z17.string().optional(),
    lastRunCommit: z17.string().optional(),
    lastRunCommand: z17.string().optional(),
    lastRunMode: z17.union([z17.literal("local"), z17.literal("remote")]).optional()
  }).strict().optional(),
  diagnostics: z17.object({
    enabled: z17.boolean().optional(),
    flags: z17.array(z17.string()).optional(),
    stuckSessionWarnMs: z17.number().int().positive().optional(),
    otel: z17.object({
      enabled: z17.boolean().optional(),
      endpoint: z17.string().optional(),
      protocol: z17.union([z17.literal("http/protobuf"), z17.literal("grpc")]).optional(),
      headers: z17.record(z17.string(), z17.string()).optional(),
      serviceName: z17.string().optional(),
      traces: z17.boolean().optional(),
      metrics: z17.boolean().optional(),
      logs: z17.boolean().optional(),
      sampleRate: z17.number().min(0).max(1).optional(),
      flushIntervalMs: z17.number().int().nonnegative().optional()
    }).strict().optional(),
    cacheTrace: z17.object({
      enabled: z17.boolean().optional(),
      filePath: z17.string().optional(),
      includeMessages: z17.boolean().optional(),
      includePrompt: z17.boolean().optional(),
      includeSystem: z17.boolean().optional()
    }).strict().optional()
  }).strict().optional(),
  logging: z17.object({
    level: LoggingLevelSchema.optional(),
    file: z17.string().optional(),
    maxFileBytes: z17.number().int().positive().optional(),
    consoleLevel: LoggingLevelSchema.optional(),
    consoleStyle: z17.union([z17.literal("pretty"), z17.literal("compact"), z17.literal("json")]).optional(),
    redactSensitive: z17.union([z17.literal("off"), z17.literal("tools")]).optional(),
    redactPatterns: z17.array(z17.string()).optional()
  }).strict().optional(),
  cli: z17.object({
    banner: z17.object({
      taglineMode: z17.union([z17.literal("random"), z17.literal("default"), z17.literal("off")]).optional()
    }).strict().optional()
  }).strict().optional(),
  update: z17.object({
    channel: z17.union([z17.literal("stable"), z17.literal("beta"), z17.literal("dev")]).optional(),
    checkOnStart: z17.boolean().optional(),
    auto: z17.object({
      enabled: z17.boolean().optional(),
      stableDelayHours: z17.number().nonnegative().max(168).optional(),
      stableJitterHours: z17.number().nonnegative().max(168).optional(),
      betaCheckIntervalHours: z17.number().positive().max(24).optional()
    }).strict().optional()
  }).strict().optional(),
  browser: z17.object({
    enabled: z17.boolean().optional(),
    evaluateEnabled: z17.boolean().optional(),
    cdpUrl: z17.string().optional(),
    remoteCdpTimeoutMs: z17.number().int().nonnegative().optional(),
    remoteCdpHandshakeTimeoutMs: z17.number().int().nonnegative().optional(),
    color: z17.string().optional(),
    executablePath: z17.string().optional(),
    headless: z17.boolean().optional(),
    noSandbox: z17.boolean().optional(),
    attachOnly: z17.boolean().optional(),
    cdpPortRangeStart: z17.number().int().min(1).max(65535).optional(),
    defaultProfile: z17.string().optional(),
    snapshotDefaults: BrowserSnapshotDefaultsSchema,
    ssrfPolicy: z17.object({
      allowPrivateNetwork: z17.boolean().optional(),
      dangerouslyAllowPrivateNetwork: z17.boolean().optional(),
      allowedHostnames: z17.array(z17.string()).optional(),
      hostnameAllowlist: z17.array(z17.string()).optional()
    }).strict().optional(),
    profiles: z17.record(
      z17.string().regex(/^[a-z0-9-]+$/, "Profile names must be alphanumeric with hyphens only"),
      z17.object({
        cdpPort: z17.number().int().min(1).max(65535).optional(),
        cdpUrl: z17.string().optional(),
        userDataDir: z17.string().optional(),
        driver: z17.union([z17.literal("openclaw"), z17.literal("clawd"), z17.literal("existing-session")]).optional(),
        attachOnly: z17.boolean().optional(),
        color: HexColorSchema
      }).strict().refine(
        (value) => value.driver === "existing-session" || value.cdpPort || value.cdpUrl,
        {
          message: "Profile must set cdpPort or cdpUrl"
        }
      ).refine((value) => value.driver === "existing-session" || !value.userDataDir, {
        message: 'Profile userDataDir is only supported with driver="existing-session"'
      })
    ).optional(),
    extraArgs: z17.array(z17.string()).optional()
  }).strict().optional(),
  ui: z17.object({
    seamColor: HexColorSchema.optional(),
    assistant: z17.object({
      name: z17.string().max(50).optional(),
      avatar: z17.string().max(200).optional()
    }).strict().optional()
  }).strict().optional(),
  secrets: SecretsConfigSchema,
  auth: z17.object({
    profiles: z17.record(
      z17.string(),
      z17.object({
        provider: z17.string(),
        mode: z17.union([z17.literal("api_key"), z17.literal("oauth"), z17.literal("token")]),
        email: z17.string().optional(),
        displayName: z17.string().optional()
      }).strict()
    ).optional(),
    order: z17.record(z17.string(), z17.array(z17.string())).optional(),
    cooldowns: z17.object({
      billingBackoffHours: z17.number().positive().optional(),
      billingBackoffHoursByProvider: z17.record(z17.string(), z17.number().positive()).optional(),
      billingMaxHours: z17.number().positive().optional(),
      failureWindowHours: z17.number().positive().optional(),
      overloadedProfileRotations: z17.number().int().nonnegative().optional(),
      overloadedBackoffMs: z17.number().int().nonnegative().optional(),
      rateLimitedProfileRotations: z17.number().int().nonnegative().optional()
    }).strict().optional()
  }).strict().optional(),
  acp: z17.object({
    enabled: z17.boolean().optional(),
    dispatch: z17.object({
      enabled: z17.boolean().optional()
    }).strict().optional(),
    backend: z17.string().optional(),
    defaultAgent: z17.string().optional(),
    allowedAgents: z17.array(z17.string()).optional(),
    maxConcurrentSessions: z17.number().int().positive().optional(),
    stream: z17.object({
      coalesceIdleMs: z17.number().int().nonnegative().optional(),
      maxChunkChars: z17.number().int().positive().optional(),
      repeatSuppression: z17.boolean().optional(),
      deliveryMode: z17.union([z17.literal("live"), z17.literal("final_only")]).optional(),
      hiddenBoundarySeparator: z17.union([
        z17.literal("none"),
        z17.literal("space"),
        z17.literal("newline"),
        z17.literal("paragraph")
      ]).optional(),
      maxOutputChars: z17.number().int().positive().optional(),
      maxSessionUpdateChars: z17.number().int().positive().optional(),
      tagVisibility: z17.record(z17.string(), z17.boolean()).optional()
    }).strict().optional(),
    runtime: z17.object({
      ttlMinutes: z17.number().int().positive().optional(),
      installCommand: z17.string().optional()
    }).strict().optional()
  }).strict().optional(),
  models: ModelsConfigSchema,
  nodeHost: NodeHostSchema,
  agents: AgentsSchema,
  tools: ToolsSchema,
  bindings: BindingsSchema,
  broadcast: BroadcastSchema,
  audio: AudioSchema,
  media: z17.object({
    preserveFilenames: z17.boolean().optional(),
    ttlHours: z17.number().int().min(1).max(24 * 7).optional()
  }).strict().optional(),
  messages: MessagesSchema,
  commands: CommandsSchema,
  approvals: ApprovalsSchema,
  session: SessionSchema,
  cron: z17.object({
    enabled: z17.boolean().optional(),
    store: z17.string().optional(),
    maxConcurrentRuns: z17.number().int().positive().optional(),
    retry: z17.object({
      maxAttempts: z17.number().int().min(0).max(10).optional(),
      backoffMs: z17.array(z17.number().int().nonnegative()).min(1).max(10).optional(),
      retryOn: z17.array(z17.enum(["rate_limit", "overloaded", "network", "timeout", "server_error"])).min(1).optional()
    }).strict().optional(),
    webhook: HttpUrlSchema.optional(),
    webhookToken: SecretInputSchema.optional().register(sensitive),
    sessionRetention: z17.union([z17.string(), z17.literal(false)]).optional(),
    runLog: z17.object({
      maxBytes: z17.union([z17.string(), z17.number()]).optional(),
      keepLines: z17.number().int().positive().optional()
    }).strict().optional(),
    failureAlert: z17.object({
      enabled: z17.boolean().optional(),
      after: z17.number().int().min(1).optional(),
      cooldownMs: z17.number().int().min(0).optional(),
      mode: z17.enum(["announce", "webhook"]).optional(),
      accountId: z17.string().optional()
    }).strict().optional(),
    failureDestination: z17.object({
      channel: z17.string().optional(),
      to: z17.string().optional(),
      accountId: z17.string().optional(),
      mode: z17.enum(["announce", "webhook"]).optional()
    }).strict().optional()
  }).strict().superRefine((val, ctx) => {
    if (val.sessionRetention !== void 0 && val.sessionRetention !== false) {
      try {
        parseDurationMs(String(val.sessionRetention).trim(), { defaultUnit: "h" });
      } catch {
        ctx.addIssue({
          code: z17.ZodIssueCode.custom,
          path: ["sessionRetention"],
          message: "invalid duration (use ms, s, m, h, d)"
        });
      }
    }
    if (val.runLog?.maxBytes !== void 0) {
      try {
        parseByteSize(String(val.runLog.maxBytes).trim(), { defaultUnit: "b" });
      } catch {
        ctx.addIssue({
          code: z17.ZodIssueCode.custom,
          path: ["runLog", "maxBytes"],
          message: "invalid size (use b, kb, mb, gb, tb)"
        });
      }
    }
  }).optional(),
  hooks: z17.object({
    enabled: z17.boolean().optional(),
    path: z17.string().optional(),
    token: z17.string().optional().register(sensitive),
    defaultSessionKey: z17.string().optional(),
    allowRequestSessionKey: z17.boolean().optional(),
    allowedSessionKeyPrefixes: z17.array(z17.string()).optional(),
    allowedAgentIds: z17.array(z17.string()).optional(),
    maxBodyBytes: z17.number().int().positive().optional(),
    presets: z17.array(z17.string()).optional(),
    transformsDir: z17.string().optional(),
    mappings: z17.array(HookMappingSchema).optional(),
    gmail: HooksGmailSchema,
    internal: InternalHooksSchema
  }).strict().optional(),
  web: z17.object({
    enabled: z17.boolean().optional(),
    heartbeatSeconds: z17.number().int().positive().optional(),
    reconnect: z17.object({
      initialMs: z17.number().positive().optional(),
      maxMs: z17.number().positive().optional(),
      factor: z17.number().positive().optional(),
      jitter: z17.number().min(0).max(1).optional(),
      maxAttempts: z17.number().int().min(0).optional()
    }).strict().optional()
  }).strict().optional(),
  channels: ChannelsSchema,
  discovery: z17.object({
    wideArea: z17.object({
      enabled: z17.boolean().optional(),
      domain: z17.string().optional()
    }).strict().optional(),
    mdns: z17.object({
      mode: z17.enum(["off", "minimal", "full"]).optional()
    }).strict().optional()
  }).strict().optional(),
  canvasHost: z17.object({
    enabled: z17.boolean().optional(),
    root: z17.string().optional(),
    port: z17.number().int().positive().optional(),
    liveReload: z17.boolean().optional()
  }).strict().optional(),
  talk: TalkSchema.optional(),
  gateway: z17.object({
    port: z17.number().int().positive().optional(),
    mode: z17.union([z17.literal("local"), z17.literal("remote")]).optional(),
    bind: z17.union([
      z17.literal("auto"),
      z17.literal("lan"),
      z17.literal("loopback"),
      z17.literal("custom"),
      z17.literal("tailnet")
    ]).optional(),
    customBindHost: z17.string().optional(),
    controlUi: z17.object({
      enabled: z17.boolean().optional(),
      basePath: z17.string().optional(),
      root: z17.string().optional(),
      allowedOrigins: z17.array(z17.string()).optional(),
      dangerouslyAllowHostHeaderOriginFallback: z17.boolean().optional(),
      allowInsecureAuth: z17.boolean().optional(),
      dangerouslyDisableDeviceAuth: z17.boolean().optional()
    }).strict().optional(),
    auth: z17.object({
      mode: z17.union([
        z17.literal("none"),
        z17.literal("token"),
        z17.literal("password"),
        z17.literal("trusted-proxy")
      ]).optional(),
      token: SecretInputSchema.optional().register(sensitive),
      password: SecretInputSchema.optional().register(sensitive),
      allowTailscale: z17.boolean().optional(),
      rateLimit: z17.object({
        maxAttempts: z17.number().optional(),
        windowMs: z17.number().optional(),
        lockoutMs: z17.number().optional(),
        exemptLoopback: z17.boolean().optional()
      }).strict().optional(),
      trustedProxy: z17.object({
        userHeader: z17.string().min(1, "userHeader is required for trusted-proxy mode"),
        requiredHeaders: z17.array(z17.string()).optional(),
        allowUsers: z17.array(z17.string()).optional()
      }).strict().optional()
    }).strict().optional(),
    trustedProxies: z17.array(z17.string()).optional(),
    allowRealIpFallback: z17.boolean().optional(),
    tools: z17.object({
      deny: z17.array(z17.string()).optional(),
      allow: z17.array(z17.string()).optional()
    }).strict().optional(),
    webchat: z17.object({
      chatHistoryMaxChars: z17.number().int().positive().max(5e5).optional()
    }).strict().optional(),
    channelHealthCheckMinutes: z17.number().int().min(0).optional(),
    channelStaleEventThresholdMinutes: z17.number().int().min(1).optional(),
    channelMaxRestartsPerHour: z17.number().int().min(1).optional(),
    tailscale: z17.object({
      mode: z17.union([z17.literal("off"), z17.literal("serve"), z17.literal("funnel")]).optional(),
      resetOnExit: z17.boolean().optional()
    }).strict().optional(),
    remote: z17.object({
      url: z17.string().optional(),
      transport: z17.union([z17.literal("ssh"), z17.literal("direct")]).optional(),
      token: SecretInputSchema.optional().register(sensitive),
      password: SecretInputSchema.optional().register(sensitive),
      tlsFingerprint: z17.string().optional(),
      sshTarget: z17.string().optional(),
      sshIdentity: z17.string().optional()
    }).strict().optional(),
    reload: z17.object({
      mode: z17.union([
        z17.literal("off"),
        z17.literal("restart"),
        z17.literal("hot"),
        z17.literal("hybrid")
      ]).optional(),
      debounceMs: z17.number().int().min(0).optional(),
      deferralTimeoutMs: z17.number().int().min(0).optional()
    }).strict().optional(),
    tls: z17.object({
      enabled: z17.boolean().optional(),
      autoGenerate: z17.boolean().optional(),
      certPath: z17.string().optional(),
      keyPath: z17.string().optional(),
      caPath: z17.string().optional()
    }).optional(),
    http: z17.object({
      endpoints: z17.object({
        chatCompletions: z17.object({
          enabled: z17.boolean().optional(),
          maxBodyBytes: z17.number().int().positive().optional(),
          maxImageParts: z17.number().int().nonnegative().optional(),
          maxTotalImageBytes: z17.number().int().positive().optional(),
          images: z17.object({
            ...ResponsesEndpointUrlFetchShape
          }).strict().optional()
        }).strict().optional(),
        responses: z17.object({
          enabled: z17.boolean().optional(),
          maxBodyBytes: z17.number().int().positive().optional(),
          maxUrlParts: z17.number().int().nonnegative().optional(),
          files: z17.object({
            ...ResponsesEndpointUrlFetchShape,
            maxChars: z17.number().int().positive().optional(),
            pdf: z17.object({
              maxPages: z17.number().int().positive().optional(),
              maxPixels: z17.number().int().positive().optional(),
              minTextChars: z17.number().int().nonnegative().optional()
            }).strict().optional()
          }).strict().optional(),
          images: z17.object({
            ...ResponsesEndpointUrlFetchShape
          }).strict().optional()
        }).strict().optional()
      }).strict().optional(),
      securityHeaders: z17.object({
        strictTransportSecurity: z17.union([z17.string(), z17.literal(false)]).optional()
      }).strict().optional()
    }).strict().optional(),
    push: z17.object({
      apns: z17.object({
        relay: z17.object({
          baseUrl: z17.string().optional(),
          timeoutMs: z17.number().int().positive().optional()
        }).strict().optional()
      }).strict().optional()
    }).strict().optional(),
    nodes: z17.object({
      browser: z17.object({
        mode: z17.union([z17.literal("auto"), z17.literal("manual"), z17.literal("off")]).optional(),
        node: z17.string().optional()
      }).strict().optional(),
      allowCommands: z17.array(z17.string()).optional(),
      denyCommands: z17.array(z17.string()).optional()
    }).strict().optional()
  }).strict().superRefine((gateway, ctx) => {
    const effectiveHealthCheckMinutes = gateway.channelHealthCheckMinutes ?? 5;
    if (gateway.channelStaleEventThresholdMinutes != null && effectiveHealthCheckMinutes !== 0 && gateway.channelStaleEventThresholdMinutes < effectiveHealthCheckMinutes) {
      ctx.addIssue({
        code: z17.ZodIssueCode.custom,
        path: ["channelStaleEventThresholdMinutes"],
        message: "channelStaleEventThresholdMinutes should be >= channelHealthCheckMinutes to avoid delayed stale detection"
      });
    }
  }).optional(),
  memory: MemorySchema,
  mcp: McpConfigSchema,
  skills: z17.object({
    allowBundled: z17.array(z17.string()).optional(),
    load: z17.object({
      extraDirs: z17.array(z17.string()).optional(),
      watch: z17.boolean().optional(),
      watchDebounceMs: z17.number().int().min(0).optional()
    }).strict().optional(),
    install: z17.object({
      preferBrew: z17.boolean().optional(),
      nodeManager: z17.union([z17.literal("npm"), z17.literal("pnpm"), z17.literal("yarn"), z17.literal("bun")]).optional()
    }).strict().optional(),
    limits: z17.object({
      maxCandidatesPerRoot: z17.number().int().min(1).optional(),
      maxSkillsLoadedPerSource: z17.number().int().min(1).optional(),
      maxSkillsInPrompt: z17.number().int().min(0).optional(),
      maxSkillsPromptChars: z17.number().int().min(0).optional(),
      maxSkillFileBytes: z17.number().int().min(0).optional()
    }).strict().optional(),
    entries: z17.record(z17.string(), SkillEntrySchema).optional()
  }).strict().optional(),
  plugins: z17.object({
    enabled: z17.boolean().optional(),
    allow: z17.array(z17.string()).optional(),
    deny: z17.array(z17.string()).optional(),
    load: z17.object({
      paths: z17.array(z17.string()).optional()
    }).strict().optional(),
    slots: z17.object({
      memory: z17.string().optional(),
      contextEngine: z17.string().optional()
    }).strict().optional(),
    entries: z17.record(z17.string(), PluginEntrySchema).optional(),
    installs: z17.record(
      z17.string(),
      z17.object({
        ...PluginInstallRecordShape
      }).strict()
    ).optional()
  }).strict().optional()
}).strict().superRefine((cfg, ctx) => {
  const agents = cfg.agents?.list ?? [];
  if (agents.length === 0) {
    return;
  }
  const agentIds = new Set(agents.map((agent) => agent.id));
  const broadcast = cfg.broadcast;
  if (!broadcast) {
    return;
  }
  for (const [peerId, ids] of Object.entries(broadcast)) {
    if (peerId === "strategy") {
      continue;
    }
    if (!Array.isArray(ids)) {
      continue;
    }
    for (let idx = 0; idx < ids.length; idx += 1) {
      const agentId = ids[idx];
      if (!agentIds.has(agentId)) {
        ctx.addIssue({
          code: z17.ZodIssueCode.custom,
          path: ["broadcast", peerId, idx],
          message: `Unknown agent id "${agentId}" (not in agents.list).`
        });
      }
    }
  }
});
export {
  OpenClawSchema
};

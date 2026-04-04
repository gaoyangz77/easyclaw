import { DEFAULTS } from "./defaults.js";

// ---------------------------------------------------------------------------
// Staging mode
// ---------------------------------------------------------------------------

/**
 * Whether the current runtime is targeting the staging backend.
 * Primary flag: RIVONCLAW_STAGING=1 (env var).
 * Also settable at runtime via setStagingDevMode() for Panel init.
 */
let _stagingOverride: boolean | undefined;

export function setStagingDevMode(enabled: boolean): void {
	_stagingOverride = enabled;
}

export function isStagingDevMode(): boolean {
	if (_stagingOverride !== undefined) return _stagingOverride;
	return typeof process !== "undefined" && process.env.RIVONCLAW_STAGING === "1";
}

// ---------------------------------------------------------------------------
// API base URL
// ---------------------------------------------------------------------------

let _apiBaseUrlOverride: string | undefined;

/** Override the API base URL globally (used by tests and Panel init). */
export function setApiBaseUrlOverride(url: string): void {
	_apiBaseUrlOverride = url;
}

/** Return the API base URL for the given language/locale. */
export function getApiBaseUrl(lang: string): string {
	if (_apiBaseUrlOverride) return _apiBaseUrlOverride;
	if (isStagingDevMode()) return `https://${DEFAULTS.domains.apiStaging}`;
	// Always use the .com API domain — the .cn domain (api.zhuazhuaai.cn)
	// resolves to a US IP and gets SNI-blocked by GFW for Chinese users.
	return `https://${DEFAULTS.domains.api}`;
}

/** Return the GraphQL endpoint URL for the given language/locale. */
export function getGraphqlUrl(lang: string): string {
	return `${getApiBaseUrl(lang)}/graphql`;
}

/** Return the telemetry endpoint URL for the given locale. */
export function getTelemetryUrl(locale: string): string {
	// Always use .com — .cn telemetry domain has same SNI-blocking issue as API.
	void locale;
	return `https://${DEFAULTS.domains.telemetry}/`;
}

// ---------------------------------------------------------------------------
// Customer-service relay URLs
// ---------------------------------------------------------------------------

/**
 * Return the CS relay WebSocket URL.
 * Overridable via CS_RELAY_URL env var for staging/testing.
 */
export function getCsRelayWsUrl(): string {
	const envOverride = typeof process !== "undefined" ? process.env.CS_RELAY_URL : undefined;
	if (envOverride) return envOverride;
	return `wss://${DEFAULTS.domains.csRelay}/ws`;
}

// ---------------------------------------------------------------------------
// Release feed URLs
// ---------------------------------------------------------------------------

/**
 * Return the release feed URL for auto-updater.
 * Respects UPDATE_FROM_STAGING env var.
 */
export function getReleaseFeedUrl(locale: string): string {
	const useStaging = typeof process !== "undefined" && process.env.UPDATE_FROM_STAGING === "1";
	if (useStaging) return `https://${DEFAULTS.domains.staging}/releases`;
	// Release feed: www.zhuazhuaai.cn is behind CDN and works, so keep .cn for zh.
	return locale === "zh"
		? `https://${DEFAULTS.domains.webCn}/releases`
		: `https://${DEFAULTS.domains.web}/releases`;
}

// ---------------------------------------------------------------------------
// Channel API endpoints — composed from DEFAULTS.channels
// ---------------------------------------------------------------------------

/** Telegram Bot API: sendMessage endpoint. */
export function getTelegramSendUrl(botToken: string): string {
	return `https://${DEFAULTS.channels.telegram}/bot${botToken}/sendMessage`;
}

/** Resolve Feishu/Lark API host based on domain variant. */
export function getFeishuHost(domain: string): string {
	return domain === "lark" ? DEFAULTS.channels.lark : DEFAULTS.channels.feishu;
}

/** Feishu/Lark tenant access token endpoint. */
export function getFeishuTokenUrl(domain: string): string {
	return `https://${getFeishuHost(domain)}/open-apis/auth/v3/tenant_access_token/internal`;
}

/** Feishu/Lark send message endpoint. */
export function getFeishuMessageUrl(domain: string): string {
	return `https://${getFeishuHost(domain)}/open-apis/im/v1/messages?receive_id_type=open_id`;
}

/** LINE Messaging API: push message endpoint. */
export function getLinePushUrl(): string {
	return `https://${DEFAULTS.channels.line}/v2/bot/message/push`;
}

/**
 * Channel domains that should bypass the outbound proxy (domestic access).
 * Used by proxy-manager to build NO_PROXY list.
 */
export const CHANNEL_NO_PROXY_DOMAINS: readonly string[] = [
	DEFAULTS.channels.feishu,
	DEFAULTS.channels.lark,
	DEFAULTS.channels.wecom,
];

// ---------------------------------------------------------------------------
// Provider API endpoints
// ---------------------------------------------------------------------------

/** Anthropic Messages API endpoint. */
export function getAnthropicMessagesUrl(): string {
	return `https://${DEFAULTS.providers.anthropic}/v1/messages`;
}

// ---------------------------------------------------------------------------
// Local model defaults — composed from DEFAULTS.ollama
// ---------------------------------------------------------------------------

/** Default Ollama base URL (e.g. "http://localhost:11434"). */
export function getOllamaBaseUrl(): string {
	return `http://${DEFAULTS.ollama.host}:${DEFAULTS.ollama.port}`;
}

/** Default Ollama OpenAI-compatible base URL (with /v1 suffix). */
export function getOllamaOpenAiBaseUrl(): string {
	return `${getOllamaBaseUrl()}/v1`;
}

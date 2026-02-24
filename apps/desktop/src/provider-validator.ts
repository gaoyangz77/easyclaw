import { createLogger } from "@easyclaw/logger";
import { getProviderMeta, providerSecretKey } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import type { Storage } from "@easyclaw/storage";
import type { SecretStore } from "@easyclaw/secrets";

const log = createLogger("provider-validator");

/**
 * Validate an API key by making a lightweight call to the provider's API.
 * Returns { valid: true } or { valid: false, error: "..." }.
 */
export async function validateProviderApiKey(
  provider: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<{ valid: boolean; error?: string }> {
  const meta = getProviderMeta(provider as LLMProvider);
  if (!meta) {
    return { valid: false, error: "Unknown provider" };
  }
  const baseUrl = meta.baseUrl;

  // OAuth-only providers (e.g. gemini) don't support API key validation
  if (meta.oauth) {
    return { valid: false, error: "This provider uses OAuth authentication and cannot be validated with an API key." };
  }

  // Amazon Bedrock uses AWS Sig v4 — skip validation
  if (provider === "amazon-bedrock") {
    return { valid: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  // Priority: per-key proxy > proxy router (system proxy) > direct
  // Per-key proxy is typically outside GFW and can reach the API directly.
  // If no per-key proxy, fall back to proxy router which handles system proxy / direct.
  const { ProxyAgent } = await import("undici");
  const dispatcher: any = new ProxyAgent(proxyUrl || "http://127.0.0.1:9999");

  try {
    let res: Response;

    if (provider === "anthropic" || provider === "claude") {
      const isOAuthToken = apiKey.startsWith("sk-ant-oat01-");
      log.info(`Validating Anthropic ${isOAuthToken ? "OAuth token" : "API key"}...`);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      };

      if (isOAuthToken) {
        headers["Authorization"] = `Bearer ${apiKey}`;
        headers["anthropic-beta"] = "claude-code-20250219,oauth-2025-04-20";
        headers["user-agent"] = "claude-cli/2.1.2 (external, cli)";
        headers["x-app"] = "cli";
        headers["anthropic-dangerous-direct-browser-access"] = "true";
      } else {
        headers["x-api-key"] = apiKey;
      }

      const body: Record<string, unknown> = {
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      };

      if (isOAuthToken) {
        body.system = "You are Claude Code, Anthropic's official CLI for Claude.";
      }

      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        ...(dispatcher && { dispatcher }),
      });
    } else if (provider === "moonshot-coding") {
      // Kimi Coding uses Anthropic Messages API — validate via POST /v1/messages
      log.info(`Validating ${provider} API key via ${baseUrl}/v1/messages ...`);
      res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "kimi-for-coding",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: controller.signal,
        ...(dispatcher && { dispatcher }),
      });
    } else if (provider === "minimax" || provider === "minimax-cn" || provider === "minimax-coding") {
      // MiniMax doesn't support GET /models — validate via a minimal chat completion
      log.info(`Validating ${provider} API key via ${baseUrl}/chat/completions ...`);
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "MiniMax-M2",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
        signal: controller.signal,
        ...(dispatcher && { dispatcher }),
      });
    } else {
      // OpenAI-compatible providers: GET /models
      log.info(`Validating ${provider} API key via ${baseUrl}/models ...`);
      res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        ...(dispatcher && { dispatcher }),
      });
    }

    log.info(`Validation response: ${res.status} ${res.statusText}`);
    if (res.status === 401 || res.status === 403) {
      // Read response body to distinguish real auth errors from firewall blocks
      const body = await res.text().catch(() => "");
      log.info(`Validation response body: ${body.slice(0, 300)}`);

      // Anthropic returns {"type":"error","error":{"type":"authentication_error",...}}
      // OpenAI returns {"error":{"code":"invalid_api_key",...}}
      // A firewall 403 will have completely different content (HTML block page, etc.)
      const isRealAuthError =
        body.includes("authentication_error") ||
        body.includes("invalid_api_key") ||
        body.includes("invalid_x-api-key") ||
        body.includes("Incorrect API key") ||
        body.includes('"unauthorized"');

      if (isRealAuthError) {
        return { valid: false, error: "Invalid API key" };
      }

      // 403 from firewall/proxy — not a key issue, likely network restriction
      return { valid: false, error: `Provider returned ${res.status} — this may be a network issue (firewall/proxy). Response: ${body.slice(0, 200)}` };
    }

    // Any non-2xx response is suspicious — don't accept the key
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.info(`Validation non-2xx response: ${res.status} body: ${body.slice(0, 300)}`);
      return { valid: false, error: `Provider returned ${res.status}: ${body.slice(0, 200)}` };
    }

    return { valid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("API key validation failed:", msg);
    if (msg.includes("abort")) {
      return { valid: false, error: "Validation timed out — check your network connection" };
    }
    return { valid: false, error: `Network error: ${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sync the active key for a provider to the canonical secret store slot.
 * The gateway reads `{provider}-api-key` — this keeps it in sync with multi-key management.
 */
export async function syncActiveKey(
  provider: string,
  storage: Storage,
  secretStore: SecretStore,
): Promise<void> {
  const activeKey = storage.providerKeys.getDefault(provider);
  const canonicalKey = providerSecretKey(provider as LLMProvider);
  if (activeKey) {
    const keyValue = await secretStore.get(`provider-key-${activeKey.id}`);
    if (keyValue) {
      await secretStore.set(canonicalKey, keyValue);
      log.info(`Synced active key for ${provider} (${activeKey.label}) to ${canonicalKey}`);
    } else if (activeKey.authType === "local") {
      // Local providers (e.g. Ollama) don't require an API key — use provider name as dummy
      await secretStore.set(canonicalKey, provider);
      log.info(`Synced dummy key for local provider ${provider} to ${canonicalKey}`);
    }
  } else {
    await secretStore.delete(canonicalKey);
    log.info(`No active key for ${provider}, removed ${canonicalKey}`);
  }
}

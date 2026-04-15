/**
 * Credits Initializer
 *
 * On startup, when access_mode is "credits":
 *  1. Calls cloud-api /api/auth/device with the device ID to obtain a JWT + balance.
 *  2. Caches the JWT in settings as `credits_token`.
 *  3. Stores the JWT in secretStore as `openrouter-api-key` so that OpenClaw
 *     uses it as the Authorization: Bearer header when calling the openrouter provider.
 *
 * HOW OPENROUTER PROXY ROUTING IS CONFIGURED:
 *
 * `gateway-config-builder.ts` calls `buildCreditsProviderOverride()` which —
 * when access_mode === "credits" — injects an `openrouter` entry into
 * `models.providers` whose baseUrl points at our cloud-api proxy:
 *
 *   baseUrl = "${CLOUD_API_URL}/api/proxy/openrouter"
 *
 * OpenClaw's `openai-completions` api handler appends "/chat/completions" to
 * baseUrl, producing:
 *
 *   POST ${CLOUD_API_URL}/api/proxy/openrouter/chat/completions
 *
 * which matches the route registered in apps/cloud-api/src/routes/proxy.ts.
 *
 * The JWT cached here as `openrouter-api-key` is forwarded by OpenClaw as the
 * Authorization: Bearer header on every request, letting cloud-api authenticate
 * the user via its auth middleware and deduct quota.
 */

import { createLogger } from "@rivonclaw/logger";
import { createCreditsClient } from "@rivonclaw/credits-client";
import type { CreditsClient } from "@rivonclaw/credits-client";
import type { Storage } from "@rivonclaw/storage";
import type { SecretStore } from "@rivonclaw/secrets";
import {
  ACCESS_MODE_KEY,
  DEFAULT_ACCESS_MODE,
  CREDITS_TOKEN_KEY,
  CLOUD_API_URL_KEY,
  DEFAULT_CLOUD_API_URL,
} from "@rivonclaw/core";

const log = createLogger("credits-initializer");

export interface CreditsInitResult {
  token: string | null;
  balance: number;
  client: CreditsClient | null;
}

/**
 * Initialize the credits system on startup.
 *
 * - Reads `access_mode` from settings (default: "credits").
 * - If mode is "credits", calls cloud-api with the device_id to get a JWT + balance.
 * - Caches the JWT in settings as `credits_token` and in secretStore as
 *   `openrouter-api-key` (so OpenClaw uses it for auth on the proxied openrouter provider).
 * - Returns `{ token, balance, client }` on success, or
 *   `{ token: null, balance: 0, client: null }` on error or non-credits mode.
 */
export async function initializeCredits(
  storage: Storage,
  secretStore: SecretStore,
  deviceId: string,
): Promise<CreditsInitResult> {
  const mode = storage.settings.get(ACCESS_MODE_KEY) ?? DEFAULT_ACCESS_MODE;

  if (mode !== "credits") {
    log.info(`Access mode is "${mode}" — skipping credits initialization`);
    return { token: null, balance: 0, client: null };
  }

  const cloudApiUrl =
    storage.settings.get(CLOUD_API_URL_KEY) ?? DEFAULT_CLOUD_API_URL;

  const client = createCreditsClient(cloudApiUrl);

  try {
    log.info(`Credits mode active — authenticating device with cloud-api at ${cloudApiUrl}`);

    const { token, balance } = await client.deviceAuth(deviceId);

    // Cache JWT in settings for persistence across restarts
    storage.settings.set(CREDITS_TOKEN_KEY, token);

    // Store JWT as "openrouter-api-key" in secretStore so OpenClaw picks it up
    // as the Authorization: Bearer header for the proxied openrouter provider.
    // See config-writer's extraProviders wiring in gateway-config-builder.ts.
    await secretStore.set("openrouter-api-key", token);

    log.info(`Credits initialized — balance: ${balance}`);

    return { token, balance, client };
  } catch (err) {
    // Resilient: log and continue — don't crash the app if cloud-api is unreachable
    log.warn("Credits initialization failed (cloud-api unreachable or error):", err);

    // Try to return a previously cached token so routes still work offline
    const cachedToken = storage.settings.get(CREDITS_TOKEN_KEY) ?? null;
    if (cachedToken) {
      log.info("Using cached credits_token from previous session");
      return { token: cachedToken, balance: 0, client };
    }

    return { token: null, balance: 0, client: null };
  }
}

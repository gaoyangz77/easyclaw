import { randomUUID } from "node:crypto";
import { createLogger } from "@easyclaw/logger";
import type { ProviderKeyEntry } from "@easyclaw/core";
import {
  loginGeminiCliOAuth,
  isGeminiCliAvailable,
  installGeminiCliLocal,
  generatePkce,
  buildAuthUrl,
  parseCallbackInput,
  exchangeCodeForTokens,
} from "./gemini-cli-oauth.js";
import type { GeminiCliOAuthCredentials } from "./gemini-cli-oauth.js";

const log = createLogger("gateway:oauth-flow");

export interface OAuthFlowCallbacks {
  openUrl: (url: string) => Promise<void>;
  onStatusUpdate?: (status: string) => void;
  /** Local proxy router URL (e.g. "http://127.0.0.1:9999") for routing through system proxy. */
  proxyUrl?: string;
}

export interface OAuthFlowResult {
  providerKeyId: string;
  email?: string;
  provider: string;
}

export interface AcquiredOAuthCredentials {
  /** Raw credentials (access token, refresh token, etc.) — never sent to the panel. */
  credentials: GeminiCliOAuthCredentials;
  /** User email from OAuth flow (for display). */
  email?: string;
  /** Masked access token for display in UI (e.g. "ya29.a0A...••••"). */
  tokenPreview: string;
}

/**
 * Mask a token for display: show first 10 chars + "••••••••".
 */
function maskToken(token: string): string {
  if (token.length <= 10) return "••••••••••••";
  return token.slice(0, 10) + "••••••••";
}

/**
 * Step 1: Acquire OAuth tokens from Google (opens browser).
 * Does NOT create provider key or store in keychain.
 * Returns raw credentials for the caller to hold temporarily.
 */
export async function acquireGeminiOAuthToken(
  callbacks: OAuthFlowCallbacks,
): Promise<AcquiredOAuthCredentials> {
  log.info("Starting Gemini CLI OAuth flow (acquire only)");

  // Auto-install Gemini CLI if not available (extracts OAuth client credentials)
  if (!isGeminiCliAvailable()) {
    log.info("Gemini CLI not found, attempting auto-install to ~/.easyclaw/gemini-cli/");
    callbacks.onStatusUpdate?.("Installing Gemini CLI...");
    const installed = await installGeminiCliLocal((msg) => {
      log.info(msg);
      callbacks.onStatusUpdate?.(msg);
    }, callbacks.proxyUrl);
    if (!installed || !isGeminiCliAvailable()) {
      throw new Error(
        "Failed to install Gemini CLI. Please install manually: npm install -g @google/gemini-cli",
      );
    }
  }

  const creds: GeminiCliOAuthCredentials = await loginGeminiCliOAuth({
    isRemote: false,
    openUrl: callbacks.openUrl,
    log: (msg) => log.info(msg),
    note: async () => {},
    prompt: async () => "",
    progress: {
      update: (msg) => {
        log.info(`OAuth: ${msg}`);
        callbacks.onStatusUpdate?.(msg);
      },
      stop: (msg) => {
        if (msg) log.info(`OAuth: ${msg}`);
      },
    },
    proxyUrl: callbacks.proxyUrl,
  });

  log.info(`OAuth acquire complete, email=${creds.email ?? "(none)"}`);

  return {
    credentials: creds,
    email: creds.email,
    tokenPreview: maskToken(creds.access ?? ""),
  };
}

/**
 * Step 2: Validate a Gemini OAuth access token by calling Google's userinfo endpoint.
 * Routes through the local proxy router which handles system proxy + per-key proxy.
 */
export async function validateGeminiAccessToken(
  accessToken: string,
  proxyUrl?: string,
  _projectId?: string,
): Promise<{ valid: boolean; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let dispatcher: any;
  if (proxyUrl) {
    const { ProxyAgent } = await import("undici");
    dispatcher = new ProxyAgent(proxyUrl);
    log.info(`Validating Gemini OAuth token through proxy router: ${proxyUrl}`);
  }

  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
      ...(dispatcher && { dispatcher }),
    });

    log.info(`OAuth token validation response: ${res.status} ${res.statusText}`);

    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: "Invalid or expired OAuth token" };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { valid: false, error: `Google API returned ${res.status}: ${body.slice(0, 200)}` };
    }
    return { valid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Gemini OAuth validation failed:", msg);
    if (msg.includes("abort")) {
      return { valid: false, error: "Validation timed out — check your network connection" };
    }
    return { valid: false, error: `Network error: ${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Step 3: Store OAuth credentials in keychain and create provider_keys row.
 * Call after validation succeeds.
 */
export async function saveGeminiOAuthCredentials(
  credentials: GeminiCliOAuthCredentials,
  storage: {
    providerKeys: {
      create(entry: ProviderKeyEntry): ProviderKeyEntry;
      getByProvider(provider: string): ProviderKeyEntry[];
      setDefault(id: string): void;
    };
  },
  secretStore: {
    set(key: string, value: string): Promise<void>;
  },
  options?: {
    proxyBaseUrl?: string | null;
    proxyCredentials?: string | null;
    label?: string;
    model?: string;
  },
): Promise<OAuthFlowResult> {
  const provider = "gemini";
  const model = options?.model || "google-gemini-cli/gemini-2.5-pro";
  const id = randomUUID();

  // Store credential JSON in Keychain
  await secretStore.set(`oauth-cred-${id}`, JSON.stringify(credentials));

  // Store proxy credentials if provided
  if (options?.proxyCredentials) {
    await secretStore.set(`proxy-auth-${id}`, options.proxyCredentials);
  }

  // Create provider_keys row
  const label = options?.label || credentials.email || "Gemini OAuth";
  const entry = storage.providerKeys.create({
    id,
    provider,
    label,
    model,
    isDefault: false,
    authType: "oauth",
    proxyBaseUrl: options?.proxyBaseUrl ?? null,
    createdAt: "",
    updatedAt: "",
  });

  // Set as default for this provider
  storage.providerKeys.setDefault(entry.id);

  log.info(`Created OAuth provider key ${id} for ${provider}`);

  return {
    providerKeyId: id,
    email: credentials.email,
    provider,
  };
}

/**
 * Start a manual OAuth flow: generate PKCE pair and auth URL.
 * Used when the local callback server fails (e.g. EADDRINUSE).
 * The caller should open the auth URL in a browser and later call
 * completeManualOAuthFlow() with the redirect URL the user pastes.
 */
export async function startManualOAuthFlow(
  callbacks: Pick<OAuthFlowCallbacks, "onStatusUpdate" | "proxyUrl">,
): Promise<{ authUrl: string; verifier: string }> {
  // Auto-install Gemini CLI if not available (same check as acquireGeminiOAuthToken)
  if (!isGeminiCliAvailable()) {
    log.info("Gemini CLI not found, attempting auto-install to ~/.easyclaw/gemini-cli/");
    callbacks.onStatusUpdate?.("Installing Gemini CLI...");
    const installed = await installGeminiCliLocal((msg) => {
      log.info(msg);
      callbacks.onStatusUpdate?.(msg);
    }, callbacks.proxyUrl);
    if (!installed || !isGeminiCliAvailable()) {
      throw new Error(
        "Failed to install Gemini CLI. Please install manually: npm install -g @google/gemini-cli",
      );
    }
  }

  const { verifier, challenge } = generatePkce();
  const authUrl = buildAuthUrl(challenge, verifier);
  log.info("Manual OAuth flow started, authUrl generated");
  return { authUrl, verifier };
}

/**
 * Complete a manual OAuth flow: parse the redirect URL the user pasted,
 * exchange the authorization code for tokens.
 */
export async function completeManualOAuthFlow(
  callbackUrl: string,
  verifier: string,
  proxyUrl?: string,
): Promise<AcquiredOAuthCredentials> {
  const parsed = parseCallbackInput(callbackUrl, verifier);
  if ("error" in parsed) {
    throw new Error(parsed.error);
  }
  if (parsed.state !== verifier) {
    throw new Error("OAuth state mismatch — please try again");
  }

  log.info("Manual OAuth: exchanging authorization code for tokens...");
  const creds = await exchangeCodeForTokens(parsed.code, verifier, proxyUrl);
  log.info(`Manual OAuth complete, email=${creds.email ?? "(none)"}`);

  return {
    credentials: creds,
    email: creds.email,
    tokenPreview: maskToken(creds.access ?? ""),
  };
}

/**
 * Run the Gemini CLI OAuth flow end-to-end (acquire + save).
 * Convenience wrapper for backward compatibility.
 */
export async function runGeminiOAuthFlow(
  storage: {
    providerKeys: {
      create(entry: ProviderKeyEntry): ProviderKeyEntry;
      getByProvider(provider: string): ProviderKeyEntry[];
      setDefault(id: string): void;
    };
  },
  secretStore: {
    set(key: string, value: string): Promise<void>;
  },
  callbacks: OAuthFlowCallbacks,
): Promise<OAuthFlowResult> {
  const acquired = await acquireGeminiOAuthToken(callbacks);
  return saveGeminiOAuthCredentials(acquired.credentials, storage, secretStore);
}

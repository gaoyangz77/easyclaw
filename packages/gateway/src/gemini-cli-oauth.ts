/**
 * Gemini CLI OAuth module — copied from vendor/openclaw/extensions/google-gemini-cli-auth/oauth.ts
 *
 * The only change: `isWSL2Sync()` import from `openclaw/plugin-sdk` is replaced
 * with a hardcoded `false`. The desktop Electron app is never WSL2/remote.
 *
 * When updating the vendor submodule, diff this file against the original.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { enrichedPath, findInPath } from "./cli-utils.js";

const CLIENT_ID_KEYS = ["OPENCLAW_GEMINI_OAUTH_CLIENT_ID", "GEMINI_CLI_OAUTH_CLIENT_ID"];
const CLIENT_SECRET_KEYS = [
  "OPENCLAW_GEMINI_OAUTH_CLIENT_SECRET",
  "GEMINI_CLI_OAUTH_CLIENT_SECRET",
];
// Use 127.0.0.1 (not "localhost") to avoid IPv6 resolution issues.
// On some systems "localhost" resolves to ::1 first, causing EADDRINUSE
// when another process occupies the IPv6 loopback.  Google OAuth desktop
// clients accept any loopback IP on any port.
const REDIRECT_URI = "http://127.0.0.1:8085/oauth2callback";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

const TIER_FREE = "free-tier";
const TIER_LEGACY = "legacy-tier";
const TIER_STANDARD = "standard-tier";

export type GeminiCliOAuthCredentials = {
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  projectId?: string;
};

export type GeminiCliOAuthContext = {
  isRemote: boolean;
  openUrl: (url: string) => Promise<void>;
  log: (msg: string) => void;
  note: (message: string, title?: string) => Promise<void>;
  prompt: (message: string) => Promise<string>;
  progress: { update: (msg: string) => void; stop: (msg?: string) => void };
  /** Local proxy router URL (e.g. "http://127.0.0.1:9999") for routing through system proxy. */
  proxyUrl?: string;
};

/**
 * Fetch through local proxy router (which handles system proxy + per-key proxy).
 * Falls back to plain fetch when no proxy URL is configured.
 */
async function proxiedFetch(
  url: string | URL,
  init?: RequestInit,
  proxyUrl?: string,
): Promise<Response> {
  if (!proxyUrl) return fetch(url, init);
  const { ProxyAgent } = await import("undici");
  return fetch(url, { ...init, dispatcher: new ProxyAgent(proxyUrl) as any });
}

function resolveEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

let cachedGeminiCliCredentials: { clientId: string; clientSecret: string } | null = null;

/** @internal */
export function clearCredentialsCache(): void {
  cachedGeminiCliCredentials = null;
}

/** Extracts OAuth credentials from the installed Gemini CLI's bundled oauth2.js. */
export function extractGeminiCliCredentials(): { clientId: string; clientSecret: string } | null {
  if (cachedGeminiCliCredentials) {
    return cachedGeminiCliCredentials;
  }

  try {
    const geminiPath = findInPath("gemini");
    if (!geminiPath) {
      return null;
    }

    const resolvedPath = realpathSync(geminiPath);
    const geminiCliDir = dirname(dirname(resolvedPath));

    const searchPaths = [
      join(
        geminiCliDir,
        "node_modules",
        "@google",
        "gemini-cli-core",
        "dist",
        "src",
        "code_assist",
        "oauth2.js",
      ),
      join(
        geminiCliDir,
        "node_modules",
        "@google",
        "gemini-cli-core",
        "dist",
        "code_assist",
        "oauth2.js",
      ),
    ];

    let content: string | null = null;
    for (const p of searchPaths) {
      if (existsSync(p)) {
        content = readFileSync(p, "utf8");
        break;
      }
    }
    if (!content) {
      const found = findFile(geminiCliDir, "oauth2.js", 10);
      if (found) {
        content = readFileSync(found, "utf8");
      }
    }
    if (!content) {
      return null;
    }

    const idMatch = content.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/);
    const secretMatch = content.match(/(GOCSPX-[A-Za-z0-9_-]+)/);
    if (idMatch && secretMatch) {
      cachedGeminiCliCredentials = { clientId: idMatch[1], clientSecret: secretMatch[1] };
      return cachedGeminiCliCredentials;
    }
  } catch {
    // Gemini CLI not installed or extraction failed
  }
  return null;
}

function findFile(dir: string, name: string, depth: number): string | null {
  if (depth <= 0) {
    return null;
  }
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isFile() && e.name === name) {
        return p;
      }
      if (e.isDirectory() && !e.name.startsWith(".")) {
        const found = findFile(p, name, depth - 1);
        if (found) {
          return found;
        }
      }
    }
  } catch {}
  return null;
}

/** Default directory for EasyClaw-managed Gemini CLI install. */
const LOCAL_GEMINI_DIR = join(homedir(), ".easyclaw", "gemini-cli");

/**
 * Extract OAuth credentials from the EasyClaw-managed local Gemini CLI install.
 */
function extractFromLocalInstall(): { clientId: string; clientSecret: string } | null {
  const coreDir = join(LOCAL_GEMINI_DIR, "node_modules", "@google", "gemini-cli-core");
  if (!existsSync(coreDir)) return null;

  const searchPaths = [
    join(coreDir, "dist", "src", "code_assist", "oauth2.js"),
    join(coreDir, "dist", "code_assist", "oauth2.js"),
  ];

  let content: string | null = null;
  for (const p of searchPaths) {
    if (existsSync(p)) {
      content = readFileSync(p, "utf8");
      break;
    }
  }
  if (!content) {
    const found = findFile(coreDir, "oauth2.js", 10);
    if (found) content = readFileSync(found, "utf8");
  }
  if (!content) return null;

  const idMatch = content.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/);
  const secretMatch = content.match(/(GOCSPX-[A-Za-z0-9_-]+)/);
  if (idMatch && secretMatch) {
    return { clientId: idMatch[1], clientSecret: secretMatch[1] };
  }
  return null;
}

/**
 * Install Gemini CLI to ~/.easyclaw/gemini-cli/ using npm.
 * Returns true on success, false on failure.
 */
async function installViaNpm(
  onProgress?: (msg: string) => void,
): Promise<boolean> {
  const npmBin = findInPath("npm");
  if (!npmBin) {
    return false;
  }

  onProgress?.("Installing Gemini CLI via npm...");

  return new Promise<boolean>((resolve) => {
    // On Windows, npm is a .cmd file that requires shell execution.
    const useShell = process.platform === "win32";
    const child = execFile(
      npmBin,
      ["install", "--prefix", LOCAL_GEMINI_DIR, "@google/gemini-cli"],
      { timeout: 120_000, shell: useShell, env: { ...process.env, NODE_ENV: "", PATH: enrichedPath() } },
      (err) => {
        if (err) {
          onProgress?.(`npm install failed: ${err.message}`);
          resolve(false);
        } else {
          cachedGeminiCliCredentials = null;
          onProgress?.("Gemini CLI installed successfully");
          resolve(true);
        }
      },
    );
    child.stderr?.on("data", () => {
      // Suppress npm stderr noise
    });
  });
}

/**
 * Download @google/gemini-cli-core directly from npm registry (no npm needed).
 * Only extracts the package to LOCAL_GEMINI_DIR so extractFromLocalInstall() can
 * find the OAuth credentials in oauth2.js.
 */
async function installViaDirectDownload(
  onProgress?: (msg: string) => void,
  proxyUrl?: string,
): Promise<boolean> {
  try {
    onProgress?.("Downloading Gemini CLI from npm registry...");

    // 1. Get package metadata to find tarball URL
    const metaRes = await proxiedFetch("https://registry.npmjs.org/@google/gemini-cli-core/latest", undefined, proxyUrl);
    if (!metaRes.ok) {
      onProgress?.(`Failed to fetch package metadata: ${metaRes.status}`);
      return false;
    }
    const meta = (await metaRes.json()) as { dist?: { tarball?: string } };
    const tarballUrl = meta.dist?.tarball;
    if (!tarballUrl) {
      onProgress?.("No tarball URL in package metadata");
      return false;
    }

    // 2. Download tarball
    onProgress?.("Downloading gemini-cli-core...");
    const tarRes = await proxiedFetch(tarballUrl, undefined, proxyUrl);
    if (!tarRes.ok) {
      onProgress?.(`Failed to download tarball: ${tarRes.status}`);
      return false;
    }
    const buffer = Buffer.from(await tarRes.arrayBuffer());

    // 3. Extract using tar (available on all macOS/Linux systems)
    const targetDir = join(LOCAL_GEMINI_DIR, "node_modules", "@google", "gemini-cli-core");
    mkdirSync(targetDir, { recursive: true });

    const tmpFile = join(LOCAL_GEMINI_DIR, "_tmp_gemini-cli-core.tgz");
    writeFileSync(tmpFile, buffer);

    try {
      // npm tarballs contain a "package/" prefix — strip it
      execFileSync("tar", ["xzf", tmpFile, "-C", targetDir, "--strip-components=1"], {
        timeout: 30_000,
      });
    } finally {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }

    cachedGeminiCliCredentials = null;
    onProgress?.("Gemini CLI core downloaded successfully");
    return true;
  } catch (err) {
    onProgress?.(`Direct download failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Install Gemini CLI credentials to ~/.easyclaw/gemini-cli/.
 * Tries npm first, falls back to direct tarball download from npm registry.
 */
export async function installGeminiCliLocal(
  onProgress?: (msg: string) => void,
  proxyUrl?: string,
): Promise<boolean> {
  mkdirSync(LOCAL_GEMINI_DIR, { recursive: true });

  // Try npm first (installs full package with all dependencies)
  if (findInPath("npm")) {
    try {
      const ok = await installViaNpm(onProgress);
      if (ok) return true;
    } catch (err) {
      onProgress?.(`npm install error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Fallback: download just gemini-cli-core directly (no npm needed)
  return installViaDirectDownload(onProgress, proxyUrl);
}

/**
 * Check if Gemini CLI OAuth credentials can be resolved (from global install,
 * local install, or env vars). Does NOT throw.
 */
export function isGeminiCliAvailable(): boolean {
  try {
    resolveOAuthClientConfig();
    return true;
  } catch {
    return false;
  }
}

function resolveOAuthClientConfig(): { clientId: string; clientSecret?: string } {
  // 1. Check env vars first (user override)
  const envClientId = resolveEnv(CLIENT_ID_KEYS);
  const envClientSecret = resolveEnv(CLIENT_SECRET_KEYS);
  if (envClientId) {
    return { clientId: envClientId, clientSecret: envClientSecret };
  }

  // 2. Try to extract from globally installed Gemini CLI
  const extracted = extractGeminiCliCredentials();
  if (extracted) {
    return extracted;
  }

  // 3. Try to extract from EasyClaw-managed local install
  const localExtracted = extractFromLocalInstall();
  if (localExtracted) {
    return localExtracted;
  }

  // 4. No credentials available
  throw new Error(
    "Gemini CLI not found. Install it first: brew install gemini-cli (or npm install -g @google/gemini-cli), or set GEMINI_CLI_OAUTH_CLIENT_ID.",
  );
}

/**
 * Replaced: the original uses `isWSL2Sync()` from `openclaw/plugin-sdk`.
 * The desktop Electron app is never WSL2, so this always returns false for non-remote.
 */
function shouldUseManualOAuthFlow(isRemote: boolean): boolean {
  return isRemote;
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthUrl(challenge: string, verifier: string): string {
  const { clientId } = resolveOAuthClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export function parseCallbackInput(
  input: string,
  expectedState: string,
): { code: string; state: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: "No input provided" };
  }

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? expectedState;
    if (!code) {
      return { error: "Missing 'code' parameter in URL" };
    }
    if (!state) {
      return { error: "Missing 'state' parameter. Paste the full URL." };
    }
    return { code, state };
  } catch {
    if (!expectedState) {
      return { error: "Paste the full redirect URL, not just the code." };
    }
    return { code: trimmed, state: expectedState };
  }
}

async function waitForLocalCallback(params: {
  expectedState: string;
  timeoutMs: number;
  onProgress?: (message: string) => void;
}): Promise<{ code: string; state: string }> {
  const port = 8085;
  const hostname = "127.0.0.1";
  const expectedPath = "/oauth2callback";

  return new Promise<{ code: string; state: string }>((resolve, reject) => {
    let timeout: NodeJS.Timeout | null = null;
    const server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? "/", `http://${hostname}:${port}`);
        if (requestUrl.pathname !== expectedPath) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain");
          res.end("Not found");
          return;
        }

        const error = requestUrl.searchParams.get("error");
        const code = requestUrl.searchParams.get("code")?.trim();
        const state = requestUrl.searchParams.get("state")?.trim();

        if (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain");
          res.end(`Authentication failed: ${error}`);
          finish(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code || !state) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain");
          res.end("Missing code or state");
          finish(new Error("Missing OAuth code or state"));
          return;
        }

        if (state !== params.expectedState) {
          // Stale callback from a previous OAuth attempt — don't close the server;
          // keep waiting for the callback that matches the current flow.
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(
            "<!doctype html><html><head><meta charset='utf-8'/></head>" +
              "<body><h2>Session expired</h2>" +
              "<p>This authorization link is from a previous attempt. " +
              "Please go back to EasyClaw and click the login button again.</p></body></html>",
          );
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          "<!doctype html><html><head><meta charset='utf-8'/></head>" +
            "<body><h2>Gemini CLI OAuth complete</h2>" +
            "<p>You can close this window and return to EasyClaw.</p></body></html>",
        );

        finish(undefined, { code, state });
      } catch (err) {
        finish(err instanceof Error ? err : new Error("OAuth callback failed"));
      }
    });

    const finish = (err?: Error, result?: { code: string; state: string }) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      try {
        server.close();
      } catch {
        // ignore close errors
      }
      if (err) {
        reject(err);
      } else if (result) {
        resolve(result);
      }
    };

    server.once("error", (err) => {
      finish(err instanceof Error ? err : new Error("OAuth callback server error"));
    });

    server.listen(port, hostname, () => {
      params.onProgress?.(`Waiting for OAuth callback on ${REDIRECT_URI}…`);
    });

    timeout = setTimeout(() => {
      finish(new Error("OAuth callback timeout"));
    }, params.timeoutMs);
  });
}

export async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  proxyUrl?: string,
): Promise<GeminiCliOAuthCredentials> {
  const { clientId, clientSecret } = resolveOAuthClientConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const response = await proxiedFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }, proxyUrl);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  if (!data.refresh_token) {
    throw new Error("No refresh token received. Please try again.");
  }

  const email = await getUserEmail(data.access_token, proxyUrl);
  // discoverProject provisions a Google Cloud project for the Code Assist API.
  // The vendor layer requires a valid projectId to make Gemini API calls, so
  // this must succeed — do NOT silence errors here.
  const projectId = await discoverProject(data.access_token, proxyUrl);
  const expiresAt = Date.now() + data.expires_in * 1000 - 5 * 60 * 1000;

  return {
    refresh: data.refresh_token,
    access: data.access_token,
    expires: expiresAt,
    projectId,
    email,
  };
}

async function getUserEmail(accessToken: string, proxyUrl?: string): Promise<string | undefined> {
  try {
    const response = await proxiedFetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, proxyUrl);
    if (response.ok) {
      const data = (await response.json()) as { email?: string };
      return data.email;
    }
  } catch {
    // ignore
  }
  return undefined;
}

async function discoverProject(accessToken: string, proxyUrl?: string): Promise<string> {
  const envProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "X-Goog-Api-Client": "gl-node/openclaw",
  };

  const loadBody = {
    cloudaicompanionProject: envProject,
    metadata: {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
      duetProject: envProject,
    },
  };

  let data: {
    currentTier?: { id?: string };
    cloudaicompanionProject?: string | { id?: string };
    allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
  } = {};

  try {
    const response = await proxiedFetch(`${CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, {
      method: "POST",
      headers,
      body: JSON.stringify(loadBody),
    }, proxyUrl);

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      if (isVpcScAffected(errorPayload)) {
        data = { currentTier: { id: TIER_STANDARD } };
      } else {
        throw new Error(`loadCodeAssist failed: ${response.status} ${response.statusText}`);
      }
    } else {
      data = (await response.json()) as typeof data;
    }
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error("loadCodeAssist failed", { cause: err });
  }

  if (data.currentTier) {
    const project = data.cloudaicompanionProject;
    if (typeof project === "string" && project) {
      return project;
    }
    if (typeof project === "object" && project?.id) {
      return project.id;
    }
    if (envProject) {
      return envProject;
    }
    // No project associated yet — fall through to onboarding to auto-provision one.
    // This happens for consumer Gemini Pro/Advanced subscriptions where the Cloud
    // project hasn't been provisioned yet.
  }

  // When the user already has a tier (e.g. Gemini Pro subscriber) but no project,
  // use free-tier onboarding to auto-provision a project. Google's backend will
  // still respect the user's actual subscription tier.
  const hasExistingTierButNoProject = !!data.currentTier;
  const tier = hasExistingTierButNoProject ? { id: TIER_FREE } : getDefaultTier(data.allowedTiers);
  const tierId = tier?.id || TIER_FREE;
  if (tierId !== TIER_FREE && !envProject) {
    throw new Error(
      "This account requires GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID to be set.",
    );
  }

  const onboardBody: Record<string, unknown> = {
    tierId,
    metadata: {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    },
  };
  if (tierId !== TIER_FREE && envProject) {
    onboardBody.cloudaicompanionProject = envProject;
    (onboardBody.metadata as Record<string, unknown>).duetProject = envProject;
  }

  const onboardResponse = await proxiedFetch(`${CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`, {
    method: "POST",
    headers,
    body: JSON.stringify(onboardBody),
  }, proxyUrl);

  if (!onboardResponse.ok) {
    throw new Error(`onboardUser failed: ${onboardResponse.status} ${onboardResponse.statusText}`);
  }

  let lro = (await onboardResponse.json()) as {
    done?: boolean;
    name?: string;
    response?: { cloudaicompanionProject?: { id?: string } };
  };

  if (!lro.done && lro.name) {
    lro = await pollOperation(lro.name, headers, proxyUrl);
  }

  const projectId = lro.response?.cloudaicompanionProject?.id;
  if (projectId) {
    return projectId;
  }
  if (envProject) {
    return envProject;
  }

  throw new Error(
    "Could not discover or provision a Google Cloud project. Set GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID.",
  );
}

function isVpcScAffected(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return false;
  }
  const details = (error as { details?: unknown[] }).details;
  if (!Array.isArray(details)) {
    return false;
  }
  return details.some(
    (item) =>
      typeof item === "object" &&
      item &&
      (item as { reason?: string }).reason === "SECURITY_POLICY_VIOLATED",
  );
}

function getDefaultTier(
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>,
): { id?: string } | undefined {
  if (!allowedTiers?.length) {
    return { id: TIER_LEGACY };
  }
  return allowedTiers.find((tier) => tier.isDefault) ?? { id: TIER_LEGACY };
}

async function pollOperation(
  operationName: string,
  headers: Record<string, string>,
  proxyUrl?: string,
): Promise<{ done?: boolean; response?: { cloudaicompanionProject?: { id?: string } } }> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const response = await proxiedFetch(`${CODE_ASSIST_ENDPOINT}/v1internal/${operationName}`, {
      headers,
    }, proxyUrl);
    if (!response.ok) {
      continue;
    }
    const data = (await response.json()) as {
      done?: boolean;
      response?: { cloudaicompanionProject?: { id?: string } };
    };
    if (data.done) {
      return data;
    }
  }
  throw new Error("Operation polling timeout");
}

export async function loginGeminiCliOAuth(
  ctx: GeminiCliOAuthContext,
): Promise<GeminiCliOAuthCredentials> {
  const needsManual = shouldUseManualOAuthFlow(ctx.isRemote);
  await ctx.note(
    needsManual
      ? [
          "You are running in a remote/VPS environment.",
          "A URL will be shown for you to open in your LOCAL browser.",
          "After signing in, copy the redirect URL and paste it back here.",
        ].join("\n")
      : [
          "Browser will open for Google authentication.",
          "Sign in with your Google account for Gemini CLI access.",
          "The callback will be captured automatically on localhost:8085.",
        ].join("\n"),
    "Gemini CLI OAuth",
  );

  const { verifier, challenge } = generatePkce();
  const authUrl = buildAuthUrl(challenge, verifier);

  if (needsManual) {
    ctx.progress.update("OAuth URL ready");
    ctx.log(`\nOpen this URL in your LOCAL browser:\n\n${authUrl}\n`);
    ctx.progress.update("Waiting for you to paste the callback URL...");
    const callbackInput = await ctx.prompt("Paste the redirect URL here: ");
    const parsed = parseCallbackInput(callbackInput, verifier);
    if ("error" in parsed) {
      throw new Error(parsed.error);
    }
    if (parsed.state !== verifier) {
      throw new Error("OAuth state mismatch - please try again");
    }
    ctx.progress.update("Exchanging authorization code for tokens...");
    return exchangeCodeForTokens(parsed.code, verifier, ctx.proxyUrl);
  }

  ctx.progress.update("Complete sign-in in browser...");
  try {
    await ctx.openUrl(authUrl);
  } catch {
    ctx.log(`\nOpen this URL in your browser:\n\n${authUrl}\n`);
  }

  try {
    const { code } = await waitForLocalCallback({
      expectedState: verifier,
      timeoutMs: 5 * 60 * 1000,
      onProgress: (msg) => ctx.progress.update(msg),
    });
    ctx.progress.update("Exchanging authorization code for tokens...");
    return await exchangeCodeForTokens(code, verifier, ctx.proxyUrl);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("EADDRINUSE") ||
        err.message.includes("port") ||
        err.message.includes("listen"))
    ) {
      // In a desktop (non-remote) app, manual prompt mode doesn't work
      // (prompt callback returns ""), so throw a clear port-conflict error.
      if (!needsManual) {
        throw new Error(
          `Port 8085 is in use by another process. Close the other application ` +
            `using port 8085 and try again.`,
          { cause: err },
        );
      }
      ctx.progress.update("Local callback server failed. Switching to manual mode...");
      ctx.log(`\nOpen this URL in your LOCAL browser:\n\n${authUrl}\n`);
      const callbackInput = await ctx.prompt("Paste the redirect URL here: ");
      const parsed = parseCallbackInput(callbackInput, verifier);
      if ("error" in parsed) {
        throw new Error(parsed.error, { cause: err });
      }
      if (parsed.state !== verifier) {
        throw new Error("OAuth state mismatch - please try again", { cause: err });
      }
      ctx.progress.update("Exchanging authorization code for tokens...");
      return exchangeCodeForTokens(parsed.code, verifier, ctx.proxyUrl);
    }
    throw err;
  }
}

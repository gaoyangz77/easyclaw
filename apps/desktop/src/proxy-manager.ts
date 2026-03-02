import { createLogger } from "@easyclaw/logger";
import { session } from "electron";
import type { ProxyRouterConfig } from "@easyclaw/proxy-router";
import { ALL_PROVIDERS, getProviderMeta, reconstructProxyUrl, resolveProxyRouterPort } from "@easyclaw/core";
import { resolveProxyRouterConfigPath } from "@easyclaw/core/node";
import type { Storage } from "@easyclaw/storage";
import type { SecretStore } from "@easyclaw/secrets";
import { join, dirname } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const log = createLogger("proxy-manager");

// Re-export from @easyclaw/core for backward compatibility.
export { resolveProxyRouterConfigPath } from "@easyclaw/core/node";

/**
 * Well-known domain to provider mapping for major LLM APIs.
 * Auto-generated from PROVIDERS baseUrl in packages/core/src/models.ts,
 * with manual overrides for domains not derivable from baseUrl.
 */
export const DOMAIN_TO_PROVIDER: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const p of ALL_PROVIDERS) {
    const meta = getProviderMeta(p);
    if (!meta) continue;
    try {
      const domain = new URL(meta.baseUrl).hostname;
      if (!map[domain]) map[domain] = p; // first (root) provider wins for shared domains
    } catch { /* skip invalid URLs */ }
  }
  // Amazon Bedrock regional endpoints (only us-east-1 is derived from baseUrl)
  Object.assign(map, {
    "bedrock-runtime.us-west-2.amazonaws.com": "amazon-bedrock",
    "bedrock-runtime.eu-west-1.amazonaws.com": "amazon-bedrock",
    "bedrock-runtime.eu-central-1.amazonaws.com": "amazon-bedrock",
    "bedrock-runtime.ap-southeast-1.amazonaws.com": "amazon-bedrock",
    "bedrock-runtime.ap-northeast-1.amazonaws.com": "amazon-bedrock",
  });
  // Google Gemini CLI OAuth (Cloud Code API) — not in baseUrl
  map["cloudcode-pa.googleapis.com"] = "gemini";
  map["oauth2.googleapis.com"] = "gemini";
  return map;
})();

/**
 * Parse Electron's PAC-format proxy string into a URL.
 * Examples: "DIRECT" → null, "PROXY 127.0.0.1:1087" → "http://127.0.0.1:1087",
 * "SOCKS5 127.0.0.1:1080" → "socks5://127.0.0.1:1080"
 */
function parsePacProxy(pac: string): string | null {
  const trimmed = pac.trim();
  if (!trimmed || trimmed === "DIRECT") return null;

  // PAC can return multiple entries separated by ";", take the first non-DIRECT one
  for (const entry of trimmed.split(";")) {
    const part = entry.trim();
    if (!part || part === "DIRECT") continue;

    const match = part.match(/^(PROXY|SOCKS5?|SOCKS4|HTTPS)\s+(.+)$/i);
    if (!match) continue;

    const [, type, hostPort] = match;
    const upper = type.toUpperCase();
    if (upper === "PROXY" || upper === "HTTPS") {
      return `http://${hostPort}`;
    }
    if (upper === "SOCKS5" || upper === "SOCKS") {
      return `socks5://${hostPort}`;
    }
    if (upper === "SOCKS4") {
      return `socks5://${hostPort}`; // Treat SOCKS4 as SOCKS5 (compatible for CONNECT)
    }
  }
  return null;
}

/**
 * Detect system proxy using Electron's session.resolveProxy().
 * Works with PAC auto-config and global proxy modes on macOS and Windows.
 */
export async function detectSystemProxy(): Promise<string | null> {
  try {
    const pac = await session.defaultSession.resolveProxy("https://www.google.com");
    log.debug(`resolveProxy returned: "${pac}"`);
    const parsed = parsePacProxy(pac);
    log.debug(`Parsed system proxy: ${parsed ?? "(none/DIRECT)"}`);
    return parsed;
  } catch (err) {
    log.warn("Failed to detect system proxy:", err);
    return null;
  }
}

/**
 * Write proxy router configuration file.
 * Called whenever provider keys or proxies change.
 */
export async function writeProxyRouterConfig(
  storage: Storage,
  secretStore: SecretStore,
  systemProxy?: string | null,
): Promise<void> {
  const configPath = resolveProxyRouterConfigPath();
  const config: ProxyRouterConfig = {
    ts: Date.now(),
    domainToProvider: DOMAIN_TO_PROVIDER,
    activeKeys: {},
    keyProxies: {},
    systemProxy: systemProxy ?? null,
  };

  // For each provider, find the first key and its proxy
  for (const provider of ALL_PROVIDERS) {
    const firstKey = storage.providerKeys.getByProvider(provider)[0];
    if (firstKey) {
      config.activeKeys[provider] = firstKey.id;

      // Reconstruct full proxy URL if configured
      if (firstKey.proxyBaseUrl) {
        const credentials = await secretStore.get(`proxy-auth-${firstKey.id}`);
        const proxyUrl = credentials
          ? reconstructProxyUrl(firstKey.proxyBaseUrl, credentials)
          : firstKey.proxyBaseUrl;
        config.keyProxies[firstKey.id] = proxyUrl;
      } else {
        config.keyProxies[firstKey.id] = null; // Direct connection
      }
    }
  }

  // Write config file
  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  log.debug(`Proxy router config written: ${Object.keys(config.activeKeys).length} providers configured`);
}

/**
 * Build proxy environment variables pointing to local proxy router.
 * Returns fixed proxy URL (127.0.0.1:DEFAULT_PROXY_ROUTER_PORT) regardless of configuration.
 * The router handles dynamic routing based on its config file.
 *
 * Chinese-domestic channel domains (Feishu, WeCom) are excluded via NO_PROXY
 * since they don't need GFW bypass. GFW-blocked channel domains (Telegram,
 * Discord, Slack, LINE) go through the proxy router so the system proxy can
 * route them out.
 */
export function buildProxyEnv(): Record<string, string> {
  const localProxyUrl = `http://127.0.0.1:${resolveProxyRouterPort()}`;
  const noProxy = [
    "localhost",
    "127.0.0.1",
    // RFC 1918 private networks — LAN-deployed models (e.g. Ollama on another machine)
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    // Chinese-domestic channel APIs — no GFW bypass needed, connect directly
    "open.feishu.cn",
    "open.larksuite.com",
    "qyapi.weixin.qq.com",
  ].join(",");
  return {
    HTTP_PROXY: localProxyUrl,
    HTTPS_PROXY: localProxyUrl,
    http_proxy: localProxyUrl,
    https_proxy: localProxyUrl,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}

/**
 * Write a CJS module that injects undici's EnvHttpProxyAgent as the global fetch dispatcher.
 * Node.js native fetch() does NOT respect HTTP_PROXY env vars by default, so this is needed
 * to make ALL fetch() calls (Telegram/Discord/Slack SDKs, etc.) go through the proxy router.
 *
 * The module is loaded via NODE_OPTIONS=--require before the gateway entry point.
 * It uses createRequire to resolve undici from the vendor's node_modules.
 */
export function writeProxySetupModule(stateDir: string, vendorDir: string): string {
  const setupPath = join(stateDir, "proxy-setup.cjs");
  const code = `\
"use strict";
const { createRequire } = require("node:module");
const path = require("node:path");
try {
  const vendorDir = ${JSON.stringify(vendorDir)};
  const vendorRequire = createRequire(path.join(vendorDir, "package.json"));
  const { setGlobalDispatcher, EnvHttpProxyAgent } = vendorRequire("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
} catch (_) {}
`;
  writeFileSync(setupPath, code, "utf-8");
  return setupPath;
}

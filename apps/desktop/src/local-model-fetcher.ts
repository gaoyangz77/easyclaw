import { formatError } from "@easyclaw/core";
import { createLogger } from "@easyclaw/logger";
import { request } from "node:http";
import { request as requestHttps } from "node:https";

const log = createLogger("local-model-fetcher");

const FETCH_TIMEOUT_MS = 5000;

/**
 * Derive the Ollama native API base from a baseUrl.
 * If baseUrl ends with /v1 (OpenAI compat), strip it.
 * e.g. "http://localhost:11434/v1" -> "http://localhost:11434"
 *      "http://localhost:11434"    -> "http://localhost:11434"
 */
function deriveOllamaBase(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "");
}

/**
 * HTTP GET using Node.js's native http/https modules.
 *
 * In Electron 28+, the global fetch() maps to net.fetch() (Chromium's network
 * stack) which reads macOS system proxy settings.  For local model servers on
 * 127.0.0.1 / LAN IPs, this causes "Cannot connect" failures on macOS packaged
 * apps because Chromium's proxy auto-detection can interfere with plain HTTP
 * connections to localhost.  Using node:http bypasses Chromium entirely.
 */
function httpGet(url: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const fn = parsed.protocol === "https:" ? requestHttps : request;
    const req = fn(parsed, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("Connection timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Fetch installed models from an Ollama server via GET /api/tags.
 */
export async function fetchOllamaModels(
  baseUrl: string,
): Promise<Array<{ id: string; name: string }>> {
  const base = deriveOllamaBase(baseUrl);
  const url = `${base}/api/tags`;

  const { status, body } = await httpGet(url, FETCH_TIMEOUT_MS);
  if (status < 200 || status >= 300) {
    throw new Error(`Ollama /api/tags returned ${status}`);
  }
  const data = JSON.parse(body) as { models?: Array<{ name: string; model?: string }> };
  const models = (data.models ?? []).map((m) => ({
    id: m.name,
    name: m.name,
  }));
  log.info(`Fetched ${models.length} model(s) from ${base}`);
  return models;
}

/**
 * Check health of a local model server.
 */
export async function checkHealth(
  baseUrl: string,
): Promise<{ ok: boolean; version?: string; error?: string }> {
  const url = `${deriveOllamaBase(baseUrl)}/api/version`;

  try {
    const { status, body } = await httpGet(url, FETCH_TIMEOUT_MS);
    if (status < 200 || status >= 300) {
      return { ok: false, error: `Server returned ${status}` };
    }
    const data = JSON.parse(body) as { version?: string };
    return { ok: true, version: data.version };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@easyclaw/logger";
import type { Storage } from "@easyclaw/storage";
import type { ArtifactStatus, ArtifactType } from "@easyclaw/core";
import { UsageCollector, InMemoryUsageStore } from "@easyclaw/telemetry";
import type { UsageFilter } from "@easyclaw/telemetry";

const log = createLogger("panel-server");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export interface PanelServerOptions {
  /** Port to listen on. Default: 3210 */
  port?: number;
  /** Directory containing the built panel files. */
  panelDistDir: string;
  /** Storage instance for SQLite-backed persistence. */
  storage: Storage;
  /** Callback fired when a rule is created, updated, or deleted. */
  onRuleChange?: (action: "created" | "updated" | "deleted", ruleId: string) => void;
}

/**
 * Parse the JSON body from an incoming HTTP request.
 */
function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Create and start a local HTTP server that serves the panel SPA
 * and provides REST API endpoints backed by real storage.
 *
 * Binds to 127.0.0.1 only for security (no external access).
 */
export function startPanelServer(options: PanelServerOptions): Server {
  const port = options.port ?? 3210;
  const distDir = resolve(options.panelDistDir);
  const { storage, onRuleChange } = options;
  const usageCollector = new UsageCollector(new InMemoryUsageStore());

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const pathname = url.pathname;

    // CORS headers for local development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (pathname.startsWith("/api/")) {
      try {
        await handleApiRoute(req, res, url, pathname, storage, usageCollector, onRuleChange);
      } catch (err) {
        log.error("API error:", err);
        sendJson(res, 500, { error: "Internal server error" });
      }
      return;
    }

    // Static file serving for panel SPA
    serveStatic(res, distDir, pathname);
  });

  server.listen(port, "127.0.0.1", () => {
    log.info("Panel server listening on http://127.0.0.1:" + port);
  });

  return server;
}

/**
 * Extract a route parameter from a pathname pattern like /api/rules/:id
 */
function extractIdFromPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  // Must be a single path segment (no slashes)
  if (rest.length === 0 || rest.includes("/")) return null;
  return rest;
}

async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  pathname: string,
  storage: Storage,
  usageCollector: UsageCollector,
  onRuleChange?: (action: "created" | "updated" | "deleted", ruleId: string) => void,
): Promise<void> {
  // --- Status ---
  if (pathname === "/api/status" && req.method === "GET") {
    const ruleCount = storage.rules.getAll().length;
    const artifactCount = storage.artifacts.getAll().length;
    sendJson(res, 200, { status: "ok", ruleCount, artifactCount });
    return;
  }

  // --- Rules ---
  if (pathname === "/api/rules" && req.method === "GET") {
    const rules = storage.rules.getAll();
    const allArtifacts = storage.artifacts.getAll();

    // Build a map of ruleId -> latest artifact
    const artifactByRuleId = new Map<string, { status: ArtifactStatus; type: ArtifactType }>();
    for (const artifact of allArtifacts) {
      // Last artifact wins (they are ordered by compiled_at ASC, so last is most recent)
      artifactByRuleId.set(artifact.ruleId, {
        status: artifact.status,
        type: artifact.type,
      });
    }

    const enrichedRules = rules.map((rule) => {
      const artifact = artifactByRuleId.get(rule.id);
      return {
        ...rule,
        artifactStatus: artifact?.status,
        artifactType: artifact?.type,
      };
    });

    sendJson(res, 200, { rules: enrichedRules });
    return;
  }

  if (pathname === "/api/rules" && req.method === "POST") {
    const body = (await parseBody(req)) as { text?: string };
    if (!body.text || typeof body.text !== "string") {
      sendJson(res, 400, { error: "Missing required field: text" });
      return;
    }

    const id = randomUUID();
    const created = storage.rules.create({ id, text: body.text });
    onRuleChange?.("created", id);
    sendJson(res, 201, created);
    return;
  }

  // Rules with ID: PUT /api/rules/:id, DELETE /api/rules/:id
  const ruleId = extractIdFromPath(pathname, "/api/rules/");
  if (ruleId) {
    if (req.method === "PUT") {
      const body = (await parseBody(req)) as { text?: string };
      if (!body.text || typeof body.text !== "string") {
        sendJson(res, 400, { error: "Missing required field: text" });
        return;
      }

      const updated = storage.rules.update(ruleId, { text: body.text });
      if (!updated) {
        sendJson(res, 404, { error: "Rule not found" });
        return;
      }

      onRuleChange?.("updated", ruleId);
      sendJson(res, 200, updated);
      return;
    }

    if (req.method === "DELETE") {
      storage.artifacts.deleteByRuleId(ruleId);
      const deleted = storage.rules.delete(ruleId);
      if (!deleted) {
        sendJson(res, 404, { error: "Rule not found" });
        return;
      }

      onRuleChange?.("deleted", ruleId);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  // --- Settings ---
  if (pathname === "/api/settings" && req.method === "GET") {
    const settings = storage.settings.getAll();
    sendJson(res, 200, { settings });
    return;
  }

  if (pathname === "/api/settings" && req.method === "PUT") {
    const body = (await parseBody(req)) as Record<string, string>;
    for (const [key, value] of Object.entries(body)) {
      if (typeof key === "string" && typeof value === "string") {
        storage.settings.set(key, value);
      }
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  // --- Channels ---
  if (pathname === "/api/channels" && req.method === "GET") {
    const channels = storage.channels.getAll();
    sendJson(res, 200, { channels });
    return;
  }

  // --- Permissions ---
  if (pathname === "/api/permissions" && req.method === "GET") {
    const permissions = storage.permissions.get();
    sendJson(res, 200, { permissions });
    return;
  }

  if (pathname === "/api/permissions" && req.method === "PUT") {
    const body = (await parseBody(req)) as { readPaths?: string[]; writePaths?: string[] };
    const permissions = storage.permissions.update({
      readPaths: body.readPaths ?? [],
      writePaths: body.writePaths ?? [],
    });
    sendJson(res, 200, { permissions });
    return;
  }

  // --- Usage ---
  if (pathname === "/api/usage" && req.method === "GET") {
    const filter: UsageFilter = {};
    const since = url.searchParams.get("since");
    const until = url.searchParams.get("until");
    const model = url.searchParams.get("model");
    const provider = url.searchParams.get("provider");
    if (since) filter.since = since;
    if (until) filter.until = until;
    if (model) filter.model = model;
    if (provider) filter.provider = provider;
    const summary = usageCollector.summarize(filter);
    sendJson(res, 200, summary);
    return;
  }

  if (pathname === "/api/usage" && req.method === "POST") {
    const body = (await parseBody(req)) as {
      model?: string;
      provider?: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      sessionId?: string;
    };
    if (
      !body.model ||
      !body.provider ||
      typeof body.inputTokens !== "number" ||
      typeof body.outputTokens !== "number" ||
      typeof body.totalTokens !== "number"
    ) {
      sendJson(res, 400, {
        error: "Missing required fields: model, provider, inputTokens, outputTokens, totalTokens",
      });
      return;
    }
    const record = usageCollector.record({
      model: body.model,
      provider: body.provider,
      inputTokens: body.inputTokens,
      outputTokens: body.outputTokens,
      totalTokens: body.totalTokens,
      sessionId: body.sessionId,
    });
    sendJson(res, 201, record);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function serveStatic(
  res: ServerResponse,
  distDir: string,
  pathname: string,
): void {
  // Prevent directory traversal
  const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  let filePath = join(distDir, safePath);

  // If the path doesn't point to an existing file, serve index.html (SPA fallback)
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, "index.html");
  }

  if (!existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }

  // Ensure the resolved path is within distDir (prevent traversal)
  const resolvedFile = resolve(filePath);
  const resolvedDist = resolve(distDir);
  if (!resolvedFile.startsWith(resolvedDist)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

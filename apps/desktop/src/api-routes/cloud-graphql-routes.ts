import type { RouteHandler } from "./api-context.js";
import { parseBody, sendJson } from "./route-utils.js";
import { rootStore } from "../store/desktop-store.js";
import { DEFAULTS } from "@rivonclaw/core";

// ── Deletion mutation map ────────────────────────────────────────────────────
// Maps GraphQL operation names to __typename so the proxy can remove entities
// from Desktop MST after a successful delete mutation.
// (ingestGraphQLResponse skips boolean responses — this fills the gap.)
const DELETION_MUTATION_MAP: Record<string, string> = {
  DeleteShop: "Shop",
  DeleteSurface: "Surface",
  DeleteRunProfile: "RunProfile",
};

// ── ToolSpecs dedup cache ───────────────────────────────────────────────────
// ToolSpecs is stable data queried by both Panel and plugin on startup.
// Cache it briefly to coalesce concurrent requests into a single backend call.
const TOOLSPECS_CACHE_TTL_MS = 5_000;
const TOOLSPECS_OP_NAME = "ToolSpecsSync";
let toolSpecsCache: { data: unknown; ts: number; inflight?: Promise<unknown> } | null = null;

function extractOperationName(query: string): string | null {
  const m = query.match(/(?:query|mutation)\s+(\w+)/);
  return m?.[1] ?? null;
}



export const handleCloudGraphqlRoutes: RouteHandler = async (req, res, _url, pathname, ctx) => {
  if (pathname === DEFAULTS.api.cloudGraphql && req.method === "POST") {
    if (!ctx.authSession) {
      sendJson(res, 200, { errors: [{ message: "Auth session not ready" }] });
      return true;
    }

    const body = await parseBody(req) as { query?: string; variables?: Record<string, unknown> };
    if (!body.query) {
      sendJson(res, 200, { errors: [{ message: "Missing query" }] });
      return true;
    }

    const opName = extractOperationName(body.query);

    // ToolSpecs-only dedup: coalesce concurrent requests for this stable query
    if (opName === TOOLSPECS_OP_NAME && toolSpecsCache) {
      if (toolSpecsCache.inflight) {
        try {
          const data = await toolSpecsCache.inflight;
          sendJson(res, 200, { data });
        } catch (err) {
          sendJson(res, 200, { errors: [{ message: err instanceof Error ? err.message : "Cloud GraphQL request failed" }] });
        }
        return true;
      }
      if (Date.now() - toolSpecsCache.ts < TOOLSPECS_CACHE_TTL_MS) {
        sendJson(res, 200, { data: toolSpecsCache.data });
        return true;
      }
    }

    // Transparent proxy: always returns 200 with standard GraphQL response.
    try {
      const fetchPromise = ctx.authSession.graphqlFetch(body.query, body.variables);

      const prevCache = opName === TOOLSPECS_OP_NAME ? toolSpecsCache : null;
      if (opName === TOOLSPECS_OP_NAME) {
        toolSpecsCache = { data: prevCache?.data ?? null, ts: prevCache?.ts ?? 0, inflight: fetchPromise };
      }

      const data = await fetchPromise;

      // Only ingest Panel responses into MST. Extension (agent tool) responses
      // return partial entities that would overwrite complete store data.
      const isExtension = req.headers["x-request-source"] === "extension";
      if (!isExtension) {
        rootStore.ingestGraphQLResponse(data as Record<string, unknown>);
      }

      // Delete mutations return booleans, which ingestGraphQLResponse skips.
      // Use the explicit map to remove the entity from Desktop MST → SSE patch → Panel.
      const deleteTypeName = opName && DELETION_MUTATION_MAP[opName];
      if (deleteTypeName && body.variables?.id) {
        rootStore.removeEntity(deleteTypeName, body.variables.id as string);
      }

      if (opName === TOOLSPECS_OP_NAME) {
        // Only update cache if we got real data — preserve previous good cache on empty results
        const specs = (data as Record<string, unknown>)?.toolSpecs;
        const hasData = Array.isArray(specs) && specs.length > 0;
        if (hasData || !prevCache?.data) {
          toolSpecsCache = { data, ts: Date.now() };
        } else {
          // Restore previous good cache — backend returned empty (likely auth not ready after hot reload)
          toolSpecsCache = prevCache;
        }
      }

      sendJson(res, 200, { data });
    } catch (err) {
      if (opName === TOOLSPECS_OP_NAME) toolSpecsCache = null;
      const message = err instanceof Error ? err.message : "Cloud GraphQL request failed";
      sendJson(res, 200, { errors: [{ message }] });
    }
    return true;
  }

  return false;
};

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveOpenClawStateDir } from "./config-writer.js";
import { resolveVendorDir } from "./vendor.js";
import { ALL_PROVIDERS, getProviderMeta, initKnownModels, PROVIDERS, type RootProvider } from "@easyclaw/core";

/** A minimal model entry for the UI (no secrets, no cost data). */
export interface CatalogModelEntry {
  id: string;
  name: string;
}

/**
 * Read the gateway's generated models.json and return model IDs grouped by provider.
 *
 * The vendor (OpenClaw) generates `agents/main/agent/models.json` inside the
 * state directory when the gateway starts. This file is the most complete source
 * — it includes both pi-ai built-in models and OpenClaw's own provider
 * definitions (Together, Venice, etc.).
 *
 * Returns an empty object if the file does not exist (e.g. first startup
 * before the gateway has run).
 */
export function readGatewayModelCatalog(
  env?: Record<string, string | undefined>,
): Record<string, CatalogModelEntry[]> {
  const stateDir = resolveOpenClawStateDir(env);
  const modelsPath = join(stateDir, "agents", "main", "agent", "models.json");

  if (!existsSync(modelsPath)) {
    return {};
  }

  try {
    const raw = readFileSync(modelsPath, "utf8");
    const data = JSON.parse(raw) as {
      providers?: Record<
        string,
        { models?: Array<{ id?: string; name?: string }> }
      >;
    };

    const providers = data?.providers ?? {};
    const result: Record<string, CatalogModelEntry[]> = {};

    for (const [provider, config] of Object.entries(providers)) {
      const models = config?.models;
      if (!Array.isArray(models) || models.length === 0) continue;

      const entries: CatalogModelEntry[] = [];
      for (const m of models) {
        const id = String(m.id ?? "").trim();
        if (!id) continue;
        entries.push({
          id,
          name: String(m.name ?? id).trim() || id,
        });
      }

      if (entries.length > 0) {
        result[provider] = entries;
      }
    }

    return result;
  } catch {
    return {};
  }
}

/** Maps vendor provider names to our provider names where they differ. */
const VENDOR_PROVIDER_ALIASES: Record<string, string> = {};

/**
 * Derive model ID aliases from the vendor's pi-ai static registry.
 * Scans all vendor providers for IDs ending in `-preview` whose base form
 * is absent — e.g. if the vendor has `gemini-3-pro-preview` but not
 * `gemini-3-pro`, we create an alias `gemini-3-pro` → `gemini-3-pro-preview`.
 *
 * This stays in sync automatically when the vendor is updated — no hardcoded
 * mapping to maintain. Works for any provider (Google, Anthropic, etc.).
 */
function deriveModelIdAliases(
  vendorCatalog: Record<string, CatalogModelEntry[]>,
): Record<string, string> {
  const aliases: Record<string, string> = {};

  for (const entries of Object.values(vendorCatalog)) {
    const ids = new Set(entries.map((e) => e.id));
    for (const id of ids) {
      if (id.endsWith("-preview")) {
        const base = id.slice(0, -"-preview".length);
        if (!ids.has(base)) {
          aliases[base] = id;
        }
      }
    }
  }

  return aliases;
}

/** Normalize model IDs and deduplicate within a single provider's entries. */
function normalizeEntries(
  entries: CatalogModelEntry[],
  modelIdAliases: Record<string, string>,
): CatalogModelEntry[] {
  const seen = new Set<string>();
  const result: CatalogModelEntry[] = [];
  for (const e of entries) {
    const id = modelIdAliases[e.id] ?? e.id;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id !== e.id ? { ...e, id } : e);
  }
  return result;
}

/**
 * Apply provider name aliases, normalize model IDs, and sort models in
 * reverse alphabetical order so that newer models appear first.
 *
 * @param modelIdAliases - Optional model ID alias map (e.g. derived from
 *   vendor catalog). When omitted, no model ID normalization is applied.
 */
export function normalizeCatalog(
  catalog: Record<string, CatalogModelEntry[]>,
  modelIdAliases: Record<string, string> = {},
): Record<string, CatalogModelEntry[]> {
  const result: Record<string, CatalogModelEntry[]> = {};

  for (const [provider, entries] of Object.entries(catalog)) {
    const mapped = VENDOR_PROVIDER_ALIASES[provider] ?? provider;

    if (entries.length === 0) continue;

    const normalized = normalizeEntries(entries, modelIdAliases);

    // Merge into existing key (alias target may already exist)
    if (result[mapped]) {
      result[mapped] = [...result[mapped], ...normalized];
    } else {
      result[mapped] = normalized;
    }
  }

  // Sort each provider's models in reverse alphabetical order by ID
  for (const models of Object.values(result)) {
    models.sort((a, b) => b.id.localeCompare(a.id));
  }

  return result;
}

/** Module-level cache for the vendor model catalog. */
let vendorCatalogCache: Record<string, CatalogModelEntry[]> | null = null;

/**
 * Dynamically import the vendor's pi-ai MODELS constant and extract { id, name }
 * per provider. This gives us the complete model catalog (700+ models across 20+
 * providers) without copying the data — the vendor's auto-generated file is the
 * single source of truth and updates when the vendor is updated.
 *
 * Results are cached in memory after the first call.
 */
export async function readVendorModelCatalog(
  vendorDirOverride?: string,
): Promise<Record<string, CatalogModelEntry[]>> {
  if (vendorCatalogCache) return vendorCatalogCache;

  try {
    const vendorDir = resolveVendorDir(vendorDirOverride);
    const piAiModelsPath = join(
      vendorDir,
      "node_modules",
      "@mariozechner",
      "pi-ai",
      "dist",
      "models.generated.js",
    );

    if (!existsSync(piAiModelsPath)) {
      vendorCatalogCache = {};
      return vendorCatalogCache;
    }

    // Dynamic import using file:// URL (required for absolute ESM paths)
    const mod = (await import(
      pathToFileURL(piAiModelsPath).href
    )) as {
      MODELS?: Record<
        string,
        Record<string, { id?: string; name?: string }>
      >;
    };

    const allModels = mod.MODELS;
    if (!allModels || typeof allModels !== "object") {
      vendorCatalogCache = {};
      return vendorCatalogCache;
    }

    const result: Record<string, CatalogModelEntry[]> = {};

    for (const [provider, modelMap] of Object.entries(allModels)) {
      if (!modelMap || typeof modelMap !== "object") continue;

      const entries: CatalogModelEntry[] = [];
      for (const model of Object.values(modelMap)) {
        const id = String(model?.id ?? "").trim();
        if (!id) continue;
        entries.push({
          id,
          name: String(model?.name ?? id).trim() || id,
        });
      }

      if (entries.length > 0) {
        result[provider] = entries;
      }
    }

    vendorCatalogCache = result;
    return result;
  } catch {
    vendorCatalogCache = {};
    return vendorCatalogCache;
  }
}

/**
 * Returns the full model catalog by merging:
 * 1. Vendor (pi-ai) built-in models (700+ models, the base)
 * 2. Gateway models.json entries (override per-provider)
 * 3. EXTRA_MODELS (our own additions like volcengine)
 *
 * Then normalizes (alias mapping + sorting) and populates KNOWN_MODELS.
 */
export async function readFullModelCatalog(
  env?: Record<string, string | undefined>,
  vendorDir?: string,
): Promise<Record<string, CatalogModelEntry[]>> {
  const [vendor, gateway] = await Promise.all([
    readVendorModelCatalog(vendorDir),
    Promise.resolve(readGatewayModelCatalog(env)),
  ]);

  // Gateway entries override vendor entries per provider
  const merged = { ...vendor, ...gateway };

  // extraModels is our curated, authoritative model list — always takes
  // precedence over stale gateway models.json entries for that provider.
  for (const p of ALL_PROVIDERS) {
    const models = getProviderMeta(p)?.extraModels;
    if (models) {
      merged[p] = models.map((m) => ({ id: m.modelId, name: m.displayName }));
    }
  }

  // Subscription plans without their own models inherit from a catalog provider.
  // Plans with `catalogProvider` (e.g. gemini → google-gemini-cli) use that
  // vendor catalog; others fall back to the parent root provider.
  for (const root of Object.keys(PROVIDERS) as RootProvider[]) {
    for (const plan of PROVIDERS[root].subscriptionPlans ?? []) {
      if (!merged[plan.id]) {
        const source = plan.catalogProvider ?? root;
        if (merged[source]) {
          merged[plan.id] = merged[source];
        }
      }
    }
  }

  // Derive model ID aliases from the vendor catalog so that IDs from
  // the dynamic models.json (e.g. "gemini-3-pro") are normalized to match
  // the vendor's static registry (e.g. "gemini-3-pro-preview").
  const modelAliases = deriveModelIdAliases(vendor);

  const result = normalizeCatalog(merged, modelAliases);

  // Populate core's KNOWN_MODELS so getDefaultModelForProvider etc. work
  initKnownModels(result);

  return result;
}

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveOpenClawStateDir } from "./config-writer.js";
import { resolveVendorDir } from "./vendor.js";
import { EXTRA_MODELS, initKnownModels } from "@easyclaw/core";

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
 * Apply provider name aliases and sort models in reverse alphabetical
 * order so that newer models (higher version numbers) appear first.
 */
export function normalizeCatalog(
  catalog: Record<string, CatalogModelEntry[]>,
): Record<string, CatalogModelEntry[]> {
  const result: Record<string, CatalogModelEntry[]> = {};

  for (const [provider, entries] of Object.entries(catalog)) {
    const mapped = VENDOR_PROVIDER_ALIASES[provider] ?? provider;

    if (entries.length === 0) continue;

    // Merge into existing key (alias target may already exist)
    if (result[mapped]) {
      result[mapped] = [...result[mapped], ...entries];
    } else {
      result[mapped] = entries;
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

  // Add EXTRA_MODELS providers that are missing from both vendor and gateway
  for (const [p, models] of Object.entries(EXTRA_MODELS)) {
    if (!merged[p] && models) {
      merged[p] = models.map((m) => ({ id: m.modelId, name: m.displayName }));
    }
  }

  const result = normalizeCatalog(merged);

  // Populate core's KNOWN_MODELS so getDefaultModelForProvider etc. work
  initKnownModels(result);

  return result;
}

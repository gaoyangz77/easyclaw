import { onPatch, applySnapshot, getSnapshot, flow, type IJsonPatch } from "mobx-state-tree";
import { randomUUID } from "node:crypto";
import { getApiBaseUrl, parseProxyUrl } from "@rivonclaw/core";
import type { ProviderKeyEntry } from "@rivonclaw/core";
import type { GQL } from "@rivonclaw/core";
import type { Storage } from "@rivonclaw/storage";
import type { SecretStore } from "@rivonclaw/secrets";
import { createLogger } from "@rivonclaw/logger";
import { RootStoreModel } from "@rivonclaw/core/models";
import type { MstProviderKeySnapshot } from "../providers/provider-key-utils.js";
import { SYSTEM_TOOL_CATALOG } from "../generated/system-tool-catalog.js";

const log = createLogger("desktop-store");

// ---------------------------------------------------------------------------
// Strip __typename from Apollo GraphQL responses before MST ingestion.
// MST strict-checks model schemas and rejects unknown properties.
// ---------------------------------------------------------------------------

function sanitizeForMst<T>(obj: T): T {
  // MST types.optional accepts undefined (uses default) but rejects null.
  // MST types.maybeNull treats undefined as null. So null→undefined is safe for all MST types.
  if (obj === null) return undefined as T;
  if (Array.isArray(obj)) return obj.map(sanitizeForMst) as T;
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key === "__typename") continue;
      result[key] = sanitizeForMst(val);
    }
    return result as T;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Desktop store environment — late-initialized infrastructure dependencies.
// The store is created before storage/secretStore/configHandlers are ready,
// so we use a module-level ref that is set once during startup.
// ---------------------------------------------------------------------------

export interface DesktopStoreEnv {
  storage: Storage;
  secretStore: SecretStore;
  syncActiveKey: (provider: string, storage: Storage, secretStore: SecretStore) => Promise<void>;
  toMstSnapshot: (entry: ProviderKeyEntry, secretStore: SecretStore) => Promise<MstProviderKeySnapshot>;
  allKeysToMstSnapshots: (entries: ProviderKeyEntry[], secretStore: SecretStore) => Promise<MstProviderKeySnapshot[]>;
  handleProviderChange: ((hint?: { configOnly?: boolean; keyOnly?: boolean }) => Promise<void>) | null;
}

let _env: DesktopStoreEnv | null = null;

/** Initialize the Desktop store environment. Called once during startup in main.ts. */
export function initDesktopStoreEnv(env: DesktopStoreEnv): void {
  _env = env;
}

function env(): DesktopStoreEnv {
  if (!_env) throw new Error("Desktop store env not initialized — call initDesktopStoreEnv() first");
  return _env;
}

// ---------------------------------------------------------------------------
// Desktop-specific RootStore: extends shared model with ingestion actions
// ---------------------------------------------------------------------------

const DesktopRootStoreModel = RootStoreModel.actions((self) => ({
  /**
   * Update systemTools from gateway catalog IDs.
   * Preserves metadata from pre-seeded SYSTEM_TOOL_CATALOG entries.
   */
  updateSystemToolsFromCatalog(catalogCoreIds: string[]) {
    if (catalogCoreIds.length === 0) return;
    const existingMeta = new Map(
      self.systemTools.map((t) => [t.id, { displayName: t.displayName, description: t.description, category: t.category }]),
    );
    applySnapshot(
      self.systemTools,
      catalogCoreIds.map((id) => {
        const meta = existingMeta.get(id);
        return {
          id,
          name: id,
          displayName: meta?.displayName ?? id,
          description: meta?.description ?? "",
          category: meta?.category ?? "system",
          source: "system",
          operationType: "system",
        };
      }),
    );
  },

  /**
   * Ingest a GraphQL response into the MST store.
   * Strips __typename fields that Apollo adds (MST rejects unknown properties).
   */
  ingestGraphQLResponse(rawData: Record<string, unknown>, variables?: Record<string, unknown>) {
    const data = sanitizeForMst(rawData);
    // Bulk array replacements
    if (Array.isArray(data.runProfiles)) applySnapshot(self.runProfiles, data.runProfiles);
    if (Array.isArray(data.surfaces)) applySnapshot(self.surfaces, data.surfaces);
    if (Array.isArray(data.toolSpecs)) applySnapshot(self.entitledTools, data.toolSpecs);
    if (Array.isArray(data.shops)) applySnapshot(self.shops, data.shops);

    // Single mutations — RunProfiles
    if (data.createRunProfile && typeof data.createRunProfile === "object") {
      self.runProfiles.push(data.createRunProfile as any);
    }
    if (data.updateRunProfile && typeof data.updateRunProfile === "object") {
      const u = data.updateRunProfile as { id: string };
      const idx = self.runProfiles.findIndex((p) => p.id === u.id);
      if (idx >= 0) applySnapshot(self.runProfiles[idx], data.updateRunProfile as any);
    }
    if (data.deleteRunProfile === true && variables?.id) {
      const idx = self.runProfiles.findIndex((p) => p.id === variables.id);
      if (idx >= 0) self.runProfiles.splice(idx, 1);
    }

    // Single mutations — Surfaces
    if (data.createSurface && typeof data.createSurface === "object") {
      self.surfaces.push(data.createSurface as any);
    }
    if (data.updateSurface && typeof data.updateSurface === "object") {
      const u = data.updateSurface as { id: string };
      const idx = self.surfaces.findIndex((s) => s.id === u.id);
      if (idx >= 0) applySnapshot(self.surfaces[idx], data.updateSurface as any);
    }
    if (data.deleteSurface === true && variables?.id) {
      const idx = self.surfaces.findIndex((s) => s.id === variables.id);
      if (idx >= 0) self.surfaces.splice(idx, 1);
    }

    // Single mutations — Shops
    if (data.createShop && typeof data.createShop === "object") {
      self.shops.push(data.createShop as any);
    }
    if (data.updateShop && typeof data.updateShop === "object") {
      const u = data.updateShop as { id: string };
      const idx = self.shops.findIndex((s) => s.id === u.id);
      if (idx >= 0) applySnapshot(self.shops[idx], data.updateShop as any);
    }
    if (data.deleteShop === true && variables?.id) {
      const idx = self.shops.findIndex((s) => s.id === variables.id);
      if (idx >= 0) self.shops.splice(idx, 1);
    }

    // ME_QUERY response — validate required userId field before ingesting
    if (data.me && typeof data.me === "object" && "userId" in (data.me as Record<string, unknown>)) {
      if (self.currentUser) {
        applySnapshot(self.currentUser, data.me as any);
      } else {
        self.currentUser = data.me as any;
      }
    }

    // Login/register response (nested user)
    if (data.login && typeof data.login === "object") {
      const login = data.login as { user?: Record<string, unknown> };
      if (login.user && typeof login.user === "object" && "userId" in login.user) {
        if (self.currentUser) {
          applySnapshot(self.currentUser, login.user as any);
        } else {
          self.currentUser = login.user as any;
        }
      }
    }
    if (data.register && typeof data.register === "object") {
      const reg = data.register as { user?: Record<string, unknown> };
      if (reg.user && typeof reg.user === "object" && "userId" in reg.user) {
        if (self.currentUser) {
          applySnapshot(self.currentUser, reg.user as any);
        } else {
          self.currentUser = reg.user as any;
        }
      }
    }

    // Module enroll/unenroll
    if (data.enrollModule && typeof data.enrollModule === "object") {
      const result = data.enrollModule as { enrolledModules?: string[]; entitlementKeys?: string[] };
      if (self.currentUser && result.enrolledModules) {
        applySnapshot(self.currentUser.enrolledModules, result.enrolledModules);
      }
      if (self.currentUser && result.entitlementKeys) {
        applySnapshot(self.currentUser.entitlementKeys, result.entitlementKeys);
      }
    }
    if (data.unenrollModule && typeof data.unenrollModule === "object") {
      const result = data.unenrollModule as { enrolledModules?: string[]; entitlementKeys?: string[] };
      if (self.currentUser && result.enrolledModules) {
        applySnapshot(self.currentUser.enrolledModules, result.enrolledModules);
      }
      if (self.currentUser && result.entitlementKeys) {
        applySnapshot(self.currentUser.entitlementKeys, result.entitlementKeys);
      }
    }

    // Platform apps, credits, session stats
    if (Array.isArray(data.platformApps)) applySnapshot(self.platformApps, data.platformApps);
    if (Array.isArray(data.myCredits)) applySnapshot(self.credits, data.myCredits);
    if (data.csSessionStats && typeof data.csSessionStats === "object") {
      if (self.sessionStats) {
        applySnapshot(self.sessionStats, data.csSessionStats as any);
      } else {
        self.sessionStats = data.csSessionStats as any;
      }
    }

    // Subscription & quota — single nullable objects
    if (data.subscriptionStatus && typeof data.subscriptionStatus === "object") {
      if (self.subscriptionStatus) {
        applySnapshot(self.subscriptionStatus, data.subscriptionStatus as any);
      } else {
        self.subscriptionStatus = data.subscriptionStatus as any;
      }
    }
    if (data.llmQuotaStatus && typeof data.llmQuotaStatus === "object") {
      if (self.llmQuotaStatus) {
        applySnapshot(self.llmQuotaStatus, data.llmQuotaStatus as any);
      } else {
        self.llmQuotaStatus = data.llmQuotaStatus as any;
      }
    }
  },

  /** Set the current user from auth REST routes (login/register/session). */
  setCurrentUser(userData: any) {
    if (self.currentUser) {
      applySnapshot(self.currentUser, userData);
    } else {
      self.currentUser = userData;
    }
  },

  /** Clear user on logout. */
  clearUser() {
    self.currentUser = null;
  },

  /** Replace all client tool specs in the MST store (from gateway RPC). */
  loadClientToolSpecs(specs: any[]) {
    applySnapshot(self.clientTools, specs);
  },

  /** Replace all provider keys in the MST store (bulk load from storage). */
  loadProviderKeys(keys: any[]) {
    applySnapshot(self.providerKeys, keys);
  },

  /** Upsert a single provider key (after create/update). */
  upsertProviderKey(key: any) {
    const idx = self.providerKeys.findIndex((k) => k.id === key.id);
    if (idx >= 0) {
      applySnapshot(self.providerKeys[idx], key);
    } else {
      self.providerKeys.push(key);
    }
  },

  /** Remove a provider key by ID. */
  removeProviderKey(id: string) {
    const idx = self.providerKeys.findIndex((k) => k.id === id);
    if (idx >= 0) self.providerKeys.splice(idx, 1);
  },
}))
.actions((self) => ({
  // ---------------------------------------------------------------------------
  // Provider key transaction actions — encapsulate full write transactions:
  // SQLite + Keychain + syncActiveKey + MST state + gateway sync.
  // Route handlers become thin validation wrappers that call these actions.
  // ---------------------------------------------------------------------------

  /** Create a new provider key (full transaction). */
  providerKeyCreate: flow(function* (data: {
    provider: string;
    label: string;
    model: string;
    apiKey?: string;
    proxyUrl?: string;
    authType?: "api_key" | "oauth" | "local" | "custom";
    baseUrl?: string;
    customProtocol?: "openai" | "anthropic";
    customModelsJson?: string;
    inputModalities?: string[];
    proxyBaseUrl?: string | null;
    proxyCredentials?: string;
  }) {
    const { storage, secretStore, syncActiveKey, toMstSnapshot, handleProviderChange } = env();

    const id = randomUUID();
    const isLocal = data.authType === "local";
    const isCustom = data.authType === "custom";

    // Parse proxy URL if provided (and not already parsed by caller)
    let proxyBaseUrl = data.proxyBaseUrl ?? null;
    if (!proxyBaseUrl && data.proxyUrl?.trim()) {
      const proxyConfig = parseProxyUrl(data.proxyUrl.trim());
      proxyBaseUrl = proxyConfig.baseUrl;
      if (proxyConfig.hasAuth && proxyConfig.credentials) {
        yield secretStore.set(`proxy-auth-${id}`, proxyConfig.credentials);
      }
    } else if (data.proxyCredentials) {
      yield secretStore.set(`proxy-auth-${id}`, data.proxyCredentials);
    }

    const currentActive = storage.providerKeys.getActive();
    const shouldActivate = !currentActive;

    // SQLite
    const entry = storage.providerKeys.create({
      id,
      provider: data.provider,
      label: data.label,
      model: data.model,
      isDefault: shouldActivate,
      proxyBaseUrl,
      authType: data.authType ?? "api_key",
      baseUrl: (isLocal || isCustom) ? (data.baseUrl || null) : null,
      customProtocol: isCustom ? (data.customProtocol || null) : null,
      customModelsJson: isCustom ? (data.customModelsJson || null) : null,
      inputModalities: data.inputModalities ?? undefined,
      source: "local",
      createdAt: "",
      updatedAt: "",
    });

    // Keychain
    if (data.apiKey) {
      yield secretStore.set(`provider-key-${id}`, data.apiKey);
    }

    if (shouldActivate) {
      storage.settings.set("llm-provider", data.provider);
    }

    // Canonical secret
    yield syncActiveKey(data.provider, storage, secretStore);

    // MST state
    const mstEntry: MstProviderKeySnapshot = yield toMstSnapshot(entry, secretStore);
    self.upsertProviderKey(mstEntry);

    // Gateway sync (fire-and-forget)
    handleProviderChange?.(shouldActivate ? { configOnly: true } : { keyOnly: true })
      ?.catch(() => {});

    return { entry, shouldActivate };
  }),

  /** Activate (set as default) an existing provider key. */
  providerKeyActivate: flow(function* (id: string) {
    const { storage, secretStore, syncActiveKey, allKeysToMstSnapshots, handleProviderChange } = env();

    const entry = storage.providerKeys.getById(id);
    if (!entry) throw new Error("Provider key not found");

    const oldActive = storage.providerKeys.getActive();

    // SQLite
    storage.providerKeys.setDefault(id);
    storage.settings.set("llm-provider", entry.provider);

    // Canonical secrets
    yield syncActiveKey(entry.provider, storage, secretStore);
    if (oldActive && oldActive.provider !== entry.provider) {
      yield syncActiveKey(oldActive.provider, storage, secretStore);
    }

    // MST state (reload all — isDefault changed on multiple entries)
    const mstKeys: MstProviderKeySnapshot[] = yield allKeysToMstSnapshots(storage.providerKeys.getAll(), secretStore);
    self.loadProviderKeys(mstKeys);

    // Gateway sync
    const providerChanged = entry.provider !== oldActive?.provider;
    const modelChanged = !oldActive || oldActive.model !== entry.model;
    if (providerChanged || modelChanged) {
      handleProviderChange?.()?.catch(() => {});
    } else {
      handleProviderChange?.({ keyOnly: true })?.catch(() => {});
    }

    return { entry, oldActive };
  }),

  /** Update fields on an existing provider key. */
  providerKeyUpdate: flow(function* (id: string, fields: {
    label?: string;
    model?: string;
    apiKey?: string;
    proxyUrl?: string;
    baseUrl?: string;
    inputModalities?: string[];
    customModelsJson?: string;
  }) {
    const { storage, secretStore, syncActiveKey, toMstSnapshot, handleProviderChange } = env();

    const existing = storage.providerKeys.getById(id);
    if (!existing) throw new Error("Provider key not found");

    // Keychain (if apiKey provided)
    if (fields.apiKey) {
      yield secretStore.set(`provider-key-${id}`, fields.apiKey);
      if (existing.isDefault) {
        yield syncActiveKey(existing.provider, storage, secretStore);
        handleProviderChange?.({ keyOnly: true })?.catch(() => {});
      }
    }

    // Parse proxy if provided
    let proxyBaseUrl: string | null | undefined = undefined;
    if (fields.proxyUrl !== undefined) {
      if (fields.proxyUrl === "" || fields.proxyUrl === null) {
        proxyBaseUrl = null;
        yield secretStore.delete(`proxy-auth-${id}`);
      } else {
        const proxyConfig = parseProxyUrl(fields.proxyUrl.trim());
        proxyBaseUrl = proxyConfig.baseUrl;
        if (proxyConfig.hasAuth && proxyConfig.credentials) {
          yield secretStore.set(`proxy-auth-${id}`, proxyConfig.credentials);
        } else {
          yield secretStore.delete(`proxy-auth-${id}`);
        }
      }
    }

    const modelChanging = !!(fields.model && fields.model !== existing.model);

    // SQLite
    const updated = storage.providerKeys.update(id, {
      label: fields.label,
      model: fields.model,
      proxyBaseUrl,
      baseUrl: fields.baseUrl,
      inputModalities: fields.inputModalities,
      customModelsJson: fields.customModelsJson,
    });

    // Gateway sync (if model/proxy changed AND is active key)
    const proxyChanged = proxyBaseUrl !== undefined && proxyBaseUrl !== existing.proxyBaseUrl;
    if (existing.isDefault && (modelChanging || proxyChanged)) {
      handleProviderChange?.()?.catch(() => {});
    }

    // MST state
    if (updated) {
      const mstEntry: MstProviderKeySnapshot = yield toMstSnapshot(updated, secretStore);
      self.upsertProviderKey(mstEntry);
    }

    return { updated, existing, modelChanging };
  }),

  /** Delete a provider key and handle promotion. */
  providerKeyDelete: flow(function* (id: string) {
    const { storage, secretStore, syncActiveKey, allKeysToMstSnapshots, handleProviderChange } = env();

    const existing = storage.providerKeys.getById(id);
    if (!existing) throw new Error("Provider key not found");

    // SQLite
    storage.providerKeys.delete(id);

    // Keychain cleanup
    yield secretStore.delete(`provider-key-${id}`);
    yield secretStore.delete(`proxy-auth-${id}`);

    // Promotion (if was default)
    let promotedKey: ProviderKeyEntry | undefined;
    if (existing.isDefault) {
      const remaining = storage.providerKeys.getAll().filter((k) => k.id !== id);
      if (remaining.length > 0) {
        storage.providerKeys.setDefault(remaining[0].id);
        storage.settings.set("llm-provider", remaining[0].provider);
        promotedKey = remaining[0];
      } else {
        storage.settings.set("llm-provider", "");
      }
    }

    // Canonical secrets
    yield syncActiveKey(existing.provider, storage, secretStore);
    if (promotedKey && promotedKey.provider !== existing.provider) {
      yield syncActiveKey(promotedKey.provider, storage, secretStore);
    }

    // MST state (reload all — isDefault may have shifted)
    const mstKeys: MstProviderKeySnapshot[] = yield allKeysToMstSnapshots(storage.providerKeys.getAll(), secretStore);
    self.loadProviderKeys(mstKeys);

    // Gateway sync
    const modelChanged = existing.isDefault && promotedKey?.model !== existing.model;
    handleProviderChange?.(modelChanged ? { configOnly: true } : { keyOnly: true })
      ?.catch(() => {});

    return { existing, promotedKey };
  }),

  /** Refresh custom models for a provider key. */
  providerKeyRefreshModels: flow(function* (id: string, models: string[]) {
    const { storage, secretStore, toMstSnapshot, handleProviderChange } = env();

    const updated = storage.providerKeys.update(id, {
      customModelsJson: JSON.stringify(models),
    });

    // MST state
    if (updated) {
      const mstEntry: MstProviderKeySnapshot = yield toMstSnapshot(updated, secretStore);
      self.upsertProviderKey(mstEntry);
    }

    // Gateway sync if this is the active key (FIX: was missing before)
    if (updated?.isDefault) {
      handleProviderChange?.({ keyOnly: true })?.catch(() => {});
    }

    return updated;
  }),

  /** Sync cloud provider key from user auth state (login/logout/key rotation). */
  providerKeySyncCloud: flow(function* (user: GQL.MeResponse | null) {
    const { storage, secretStore, syncActiveKey, toMstSnapshot, allKeysToMstSnapshots, handleProviderChange } = env();

    const CLOUD_PROVIDER_ID = "rivonclaw-pro";
    const CLOUD_KEY_LABEL = "RivonClaw Pro";
    const llmKey = user?.llmKey?.key;
    const existing = storage.providerKeys.getAll().find((k) => k.provider === CLOUD_PROVIDER_ID);

    if (!llmKey) {
      // Logged out or no key — clean up if exists
      if (existing) {
        const wasDefault = existing.isDefault;
        storage.providerKeys.delete(existing.id);
        yield secretStore.delete(`provider-key-${existing.id}`);

        if (wasDefault) {
          const remaining = storage.providerKeys.getAll();
          if (remaining.length > 0) {
            storage.providerKeys.setDefault(remaining[0].id);
            storage.settings.set("llm-provider", remaining[0].provider);
            yield syncActiveKey(remaining[0].provider, storage, secretStore);
          } else {
            storage.settings.set("llm-provider", "");
          }
        }
        yield syncActiveKey(CLOUD_PROVIDER_ID, storage, secretStore);

        // MST state (reload all — isDefault may have shifted)
        const mstKeys: MstProviderKeySnapshot[] = yield allKeysToMstSnapshots(storage.providerKeys.getAll(), secretStore);
        self.loadProviderKeys(mstKeys);

        // Gateway sync (FIX: was missing before)
        handleProviderChange?.(wasDefault ? { configOnly: true } : { keyOnly: true })
          ?.catch(() => {});

        log.info("Removed cloud provider key (user logged out or key absent)");
      }
      return;
    }

    // User has llmKey — upsert
    if (existing) {
      // Update the secret (handles key rotation)
      yield secretStore.set(`provider-key-${existing.id}`, llmKey);
      if (existing.isDefault) {
        yield syncActiveKey(CLOUD_PROVIDER_ID, storage, secretStore);
        // Gateway sync for key rotation (FIX: was missing before)
        handleProviderChange?.({ keyOnly: true })?.catch(() => {});
      }

      // MST state
      const mstEntry: MstProviderKeySnapshot = yield toMstSnapshot(existing, secretStore);
      self.upsertProviderKey(mstEntry);

      log.info("Updated cloud provider key secret");
      return;
    }

    // Create new entry
    const baseUrl = `${getApiBaseUrl("en")}/llm/v1`;
    const shouldActivate = !storage.providerKeys.getActive();

    // Fetch available models from cloud endpoint
    let modelIds: string[] = [];
    try {
      const res: Response = yield fetch(baseUrl + "/models", {
        headers: { Authorization: `Bearer ${llmKey}` },
      });
      if (res.ok) {
        const data = (yield res.json()) as { data?: Array<{ id: string }> };
        modelIds = data.data?.map((m) => m.id) ?? [];
      }
    } catch {
      // Model fetch failed — create entry with empty models
    }

    const entry = storage.providerKeys.create({
      id: `cloud-${CLOUD_PROVIDER_ID}`,
      provider: CLOUD_PROVIDER_ID,
      label: CLOUD_KEY_LABEL,
      model: modelIds[0] ?? "",
      isDefault: shouldActivate,
      authType: "custom",
      baseUrl,
      customProtocol: "openai",
      customModelsJson: modelIds.length > 0 ? JSON.stringify(modelIds) : null,
      inputModalities: undefined,
      source: "cloud",
      createdAt: "",
      updatedAt: "",
    });

    yield secretStore.set(`provider-key-${entry.id}`, llmKey);

    if (shouldActivate) {
      storage.settings.set("llm-provider", CLOUD_PROVIDER_ID);
    }
    yield syncActiveKey(CLOUD_PROVIDER_ID, storage, secretStore);

    // MST state
    const mstEntry: MstProviderKeySnapshot = yield toMstSnapshot(entry, secretStore);
    self.upsertProviderKey(mstEntry);

    // Gateway sync (FIX: was missing before — new cloud key never triggered gateway sync)
    handleProviderChange?.(shouldActivate ? { configOnly: true } : { keyOnly: true })
      ?.catch(() => {});

    log.info(`Created cloud provider key (activated: ${shouldActivate})`);
  }),
}));

/** Singleton MST store instance for the Desktop process. */
export const rootStore = DesktopRootStoreModel.create({
  systemTools: SYSTEM_TOOL_CATALOG.map((t) => ({
    id: t.id,
    name: t.id,
    displayName: t.label ?? t.id,
    description: t.description ?? "",
    category: t.section ?? "system",
    source: "system",
    operationType: "system",
  })),
});

// ---------------------------------------------------------------------------
// Patch listener registry (used by SSE broadcasting in Phase 2)
// ---------------------------------------------------------------------------

type PatchListener = (patches: IJsonPatch[]) => void;
const patchListeners = new Set<PatchListener>();

export function subscribeToPatch(listener: PatchListener): () => void {
  patchListeners.add(listener);
  return () => patchListeners.delete(listener);
}

// Batch patches within the same microtask to avoid SSE message storms.
// A single applySnapshot of 50 entitledTools fires 50+ onPatch calls synchronously;
// buffering them into one flush prevents Panel render thrashing.
let patchBuffer: IJsonPatch[] = [];
let flushScheduled = false;

function flushPatches() {
  flushScheduled = false;
  if (patchBuffer.length === 0) return;
  const batch = patchBuffer;
  patchBuffer = [];
  for (const listener of patchListeners) {
    listener(batch);
  }
}

onPatch(rootStore, (patch) => {
  patchBuffer.push(patch);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flushPatches);
  }
});

export { getSnapshot };

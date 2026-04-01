import { types, flow, getRoot, getEnv } from "mobx-state-tree";
import { randomUUID } from "node:crypto";
import { parseProxyUrl, resolveGatewayProvider, getApiBaseUrl, ScopeType } from "@rivonclaw/core";
import type { LLMProvider, ProviderKeyEntry, ToolScopeType } from "@rivonclaw/core";
import type { Storage } from "@rivonclaw/storage";
import type { SecretStore } from "@rivonclaw/secrets";
import type { GatewayRpcClient } from "@rivonclaw/gateway";
import { createLogger } from "@rivonclaw/logger";
import type { MstProviderKeySnapshot } from "../providers/provider-key-utils.js";

const log = createLogger("llm-provider-manager");

// ---------------------------------------------------------------------------
// Environment interface — late-initialized infrastructure dependencies.
// ---------------------------------------------------------------------------

export interface LLMProviderManagerEnv {
  storage: Storage;
  secretStore: SecretStore;
  getRpcClient: () => GatewayRpcClient | null;
  toMstSnapshot: (entry: ProviderKeyEntry, secretStore: SecretStore) => Promise<MstProviderKeySnapshot>;
  allKeysToMstSnapshots: (entries: ProviderKeyEntry[], secretStore: SecretStore) => Promise<MstProviderKeySnapshot[]>;
  syncActiveKey: (provider: string, storage: Storage, secretStore: SecretStore) => Promise<void>;
  syncAllAuthProfiles: (stateDir: string, storage: Storage, secretStore: SecretStore) => Promise<void>;
  writeProxyRouterConfig: (storage: Storage, secretStore: SecretStore, lastSystemProxy: string | null) => Promise<void>;
  writeDefaultModelToConfig: (gwProvider: string, modelId: string) => void;
  /** Rewrite the full gateway config (used when provider-level config changes, e.g., new custom provider added). */
  writeFullGatewayConfig: () => Promise<void>;
  /** Full gateway restart (stop + start). Reloads plugins. */
  restartGateway: () => Promise<void>;
  stateDir: string;
  getLastSystemProxy: () => string | null;
}

// ---------------------------------------------------------------------------
// Helper: resolve the gateway model reference (e.g., "anthropic/claude-sonnet-4-20250514")
// ---------------------------------------------------------------------------

function resolveModelRef(provider: string, model: string, authType?: string): string {
  const gwProvider = authType === "custom"
    ? provider
    : resolveGatewayProvider(provider as LLMProvider);
  return `${gwProvider}/${model}`;
}

// ---------------------------------------------------------------------------
// MST Model
// ---------------------------------------------------------------------------

/** Per-session model override (volatile — not persisted, cleared on app restart). */
export interface SessionModelOverride {
  provider: string;
  model: string;
}

/** Scope context for model resolution. */
export interface ModelScope {
  type: ToolScopeType;  // e.g., ScopeType.CS_SESSION
  shopId?: string;      // scope detail: which shop (for CS)
  [key: string]: string | undefined;  // extensible for future scope types
}

export const LLMProviderManagerModel = types
  .model("LLMProviderManager", {
    activeKeyId: types.maybeNull(types.string),
  })
  .volatile(() => ({
    /** Per-session model overrides. Key = session key, value = { provider, model }. */
    sessionOverrides: new Map<string, SessionModelOverride>(),
    /** Sessions that have had activity since app startup. Only these are patched on global default change. */
    activeSessions: new Set<string>(),
    /** Cached model catalog for validation. Set of "provider/modelId" strings. */
    catalogModelIds: new Set<string>(),
  }))
  .views((self) => ({
    get root(): any {
      return getRoot(self);
    },
    /** Get the model override for a session, or null if using global default. */
    getSessionModel(sessionKey: string): SessionModelOverride | null {
      return self.sessionOverrides.get(sessionKey) ?? null;
    },
    /** Get the fully resolved model info for a session (override → global fallback). */
    getSessionModelInfo(sessionKey: string): {
      provider: string; model: string; isOverridden: boolean;
    } | null {
      const { storage } = (self as any)._env as LLMProviderManagerEnv;
      const activeKey = storage.providerKeys.getActive();
      if (!activeKey) return null;

      const override = self.sessionOverrides.get(sessionKey);
      if (override) {
        return { provider: override.provider, model: override.model, isOverridden: true };
      }
      return { provider: activeKey.provider, model: activeKey.model, isOverridden: false };
    },
  }))
  .actions((self) => {
    // ── Internal helpers ────────────────────────────────────────────────

    function getEnvDeps(): LLMProviderManagerEnv {
      // Access environment from root store
      return (self as any)._env;
    }

    /**
     * Patch a single session with a model reference, or null for global default.
     */
    async function patchSession(sessionKey: string, modelRef: string | null): Promise<void> {
      const { getRpcClient } = getEnvDeps();
      const rpc = getRpcClient();
      if (!rpc) throw new Error("RPC client not available");
      await rpc.request("sessions.patch", { key: sessionKey, model: modelRef });
    }

    /**
     * Reset active sessions that are "following default" (no explicit volatile override)
     * to pick up a new global default. Only sessions with activity since app startup
     * are patched — avoids touching hundreds of dormant sessions.
     * Best-effort: failures are logged but do not propagate.
     */
    async function resetDefaultFollowingSessions(): Promise<void> {
      const toReset = [...self.activeSessions].filter((key) => !self.sessionOverrides.has(key));
      if (toReset.length === 0) return;

      await Promise.allSettled(
        toReset.map((key) =>
          patchSession(key, null).catch((err: unknown) => {
            log.warn(`Failed to reset session ${key} to default:`, err);
          }),
        ),
      );
      log.info(`Reset ${toReset.length} active session(s) to new global default`);
    }

    /** Check if a provider/model combo is available in the cached catalog. */
    function isModelAvailable(provider: string, model: string): boolean {
      if (self.catalogModelIds.size === 0) return true; // no catalog yet, allow
      return self.catalogModelIds.has(`${provider}/${model}`) || self.catalogModelIds.has(model);
    }

    /**
     * Resolve model for a scope by reading entity cache.
     * Returns null if no scope override or if override model is unavailable.
     */
    function resolveModelForScope(scope: ModelScope): SessionModelOverride | null {
      if (scope.type === ScopeType.CS_SESSION && scope.shopId) {
        const shops = self.root.shops;
        const shop = shops?.find?.((s: any) => s.id === scope.shopId);
        const cs = shop?.services?.customerService;
        const provider = cs?.csProviderOverride;
        const model = cs?.csModelOverride;
        if (provider && model) {
          if (isModelAvailable(provider, model)) {
            return { provider, model };
          }
          log.warn(`CS model override ${provider}/${model} for shop ${scope.shopId} not in catalog, falling back`);
          return null;
        }
      }
      // Future scope types can be added here
      return null;
    }

    /**
     * Write ONLY agents.defaults.model.primary to the config file.
     * Chokidar detects this as a hot-reload (restart-heartbeat), NOT a full restart.
     */
    function writeDefaultModel(provider: string, modelId: string, authType?: string): void {
      const { writeDefaultModelToConfig } = getEnvDeps();
      const gwProvider = authType === "custom" ? provider : resolveGatewayProvider(provider as LLMProvider);
      writeDefaultModelToConfig(gwProvider, modelId);
      log.info(`Updated default model to ${gwProvider}/${modelId}`);
    }

    /**
     * Sync auth profiles and proxy router config.
     */
    async function syncAuthAndProxy(): Promise<void> {
      const { syncAllAuthProfiles, writeProxyRouterConfig, stateDir, storage, secretStore, getLastSystemProxy } = getEnvDeps();
      await Promise.all([
        syncAllAuthProfiles(stateDir, storage, secretStore),
        writeProxyRouterConfig(storage, secretStore, getLastSystemProxy()),
      ]);
    }

    /**
     * Sync auth + proxy + rewrite full gateway config.
     * Used when provider-level config changes (new provider added, provider deleted,
     * custom models refreshed) — not for simple model switches.
     */
    async function syncAuthProxyAndConfig(): Promise<void> {
      const { writeFullGatewayConfig } = getEnvDeps();
      await syncAuthAndProxy();
      await writeFullGatewayConfig();
    }

    // ── Public actions ──────────────────────────────────────────────────

    return {
      /** Set the environment dependencies. Called once during startup. */
      setEnv(env: LLMProviderManagerEnv) {
        (self as any)._env = env;
      },

      /** Initialize activeKeyId from storage. Called during startup. */
      initFromStorage() {
        const { storage } = getEnvDeps();
        const active = storage.providerKeys.getActive();
        self.activeKeyId = active?.id ?? null;
      },

      /** Refresh the cached model catalog (call after provider key changes). */
      refreshModelCatalog: flow(function* () {
        try {
          const { readFullModelCatalog } = yield import("@rivonclaw/gateway");
          const catalog: Record<string, Array<{ id: string }>> = yield readFullModelCatalog();
          const ids = new Set<string>();
          for (const [provider, models] of Object.entries(catalog)) {
            for (const m of models) {
              ids.add(`${provider}/${m.id}`);
              ids.add(m.id);
            }
          }
          self.catalogModelIds = ids;
          log.info(`Model catalog refreshed: ${ids.size} entries`);
        } catch (err) {
          log.warn("Failed to refresh model catalog:", err);
        }
      }),

      /** Mark a session as active (had activity since app startup). */
      trackSessionActivity(sessionKey: string) {
        self.activeSessions.add(sessionKey);
      },

      /**
       * Switch the model for a single session only (per-session override).
       * Does NOT change the global default or other sessions.
       */
      switchModelForSession: flow(function* (sessionKey: string, provider: string, model: string) {
        const modelRef = resolveModelRef(provider, model);
        yield patchSession(sessionKey, modelRef);
        self.sessionOverrides.set(sessionKey, { provider, model });
        self.activeSessions.add(sessionKey);
        log.info(`Switched session ${sessionKey} to ${modelRef}`);
      }),

      /** Clear per-session override — session reverts to global default. */
      resetSessionModel: flow(function* (sessionKey: string) {
        self.sessionOverrides.delete(sessionKey);
        yield patchSession(sessionKey, null);
        log.info(`Reset session ${sessionKey} to global default`);
      }),

      /**
       * Resolve and apply the best model for a session based on the override chain:
       *   1. Session-level override (explicit per-session switch)
       *   2. Scope-level override (e.g., per-shop CS model from entity cache)
       *   3. Global default (sessions.patch model: null)
       *
       * If a resolved model is unavailable in the catalog, falls through to the next layer.
       */
      applyModelForSession: flow(function* (sessionKey: string, scope?: ModelScope) {
        self.activeSessions.add(sessionKey);

        // Layer 1: session-level override
        const sessionOverride = self.sessionOverrides.get(sessionKey);
        if (sessionOverride) {
          if (isModelAvailable(sessionOverride.provider, sessionOverride.model)) {
            const ref = resolveModelRef(sessionOverride.provider, sessionOverride.model);
            yield patchSession(sessionKey, ref);
            log.info(`Applied session override ${ref} to ${sessionKey}`);
            return sessionOverride;
          }
          log.warn(`Session override ${sessionOverride.provider}/${sessionOverride.model} unavailable, checking scope`);
        }

        // Layer 2: scope-level override (e.g., per-shop CS model)
        if (scope) {
          const scopeModel = resolveModelForScope(scope);
          if (scopeModel) {
            const ref = resolveModelRef(scopeModel.provider, scopeModel.model);
            yield patchSession(sessionKey, ref);
            log.info(`Applied scope override ${ref} to ${sessionKey} (${scope.type}/${scope.shopId ?? ""})`);
            return scopeModel;
          }
        }

        // Layer 3: global default
        yield patchSession(sessionKey, null);
        log.info(`Applied global default to ${sessionKey}`);
        return null;
      }),

      /**
       * Switch the default model on an existing key (global default).
       * Only affects NEW sessions. Existing sessions keep their current model.
       */
      switchModel: flow(function* (keyId: string, newModel: string) {
        const { storage, secretStore, toMstSnapshot } = getEnvDeps();

        const entry = storage.providerKeys.getById(keyId);
        if (!entry) throw new Error("Provider key not found");

        // SQLite + MST update
        const updated = storage.providerKeys.update(keyId, { model: newModel });
        if (updated) {
          const mstEntry: MstProviderKeySnapshot = yield toMstSnapshot(updated, secretStore);
          self.root.upsertProviderKey(mstEntry);
        }

        // Update OpenClaw config default (chokidar hot-reload, no restart)
        if (entry.isDefault) {
          writeDefaultModel(entry.provider, newModel, entry.authType);
          // Reset sessions following default so they pick up the new model
          resetDefaultFollowingSessions().catch(() => {});
        }

        return updated;
      }),

      /**
       * Activate (set as default) an existing provider key.
       * Only affects NEW sessions. Existing sessions keep their current model.
       */
      activateProvider: flow(function* (keyId: string) {
        const { storage, secretStore, syncActiveKey, allKeysToMstSnapshots } = getEnvDeps();

        const entry = storage.providerKeys.getById(keyId);
        if (!entry) throw new Error("Provider key not found");

        const oldActive = storage.providerKeys.getActive();

        // SQLite
        storage.providerKeys.setDefault(keyId);
        storage.settings.set("llm-provider", entry.provider);
        self.activeKeyId = keyId;

        // Canonical secrets
        yield syncActiveKey(entry.provider, storage, secretStore);
        if (oldActive && oldActive.provider !== entry.provider) {
          yield syncActiveKey(oldActive.provider, storage, secretStore);
        }

        // MST state (reload all — isDefault changed on multiple entries)
        const mstKeys: MstProviderKeySnapshot[] = yield allKeysToMstSnapshots(
          storage.providerKeys.getAll(),
          secretStore,
        );
        self.root.loadProviderKeys(mstKeys);

        // Sync auth profiles and proxy config (so new provider's key is prioritized)
        yield syncAuthAndProxy();

        // Update OpenClaw config default (chokidar hot-reload, no restart)
        writeDefaultModel(entry.provider, entry.model, entry.authType);
        // Reset sessions following default so they pick up the new provider/model
        resetDefaultFollowingSessions().catch(() => {});

        return { entry, oldActive };
      }),

      /**
       * Create a new provider key (full transaction).
       */
      createKey: flow(function* (data: {
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
        const { storage, secretStore, syncActiveKey, toMstSnapshot } = getEnvDeps();

        const id = randomUUID();
        const isLocal = data.authType === "local";
        const isCustom = data.authType === "custom";

        // Parse proxy URL if provided
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
          self.activeKeyId = id;
        }

        // Canonical secret
        yield syncActiveKey(data.provider, storage, secretStore);

        // MST state
        const mstEntry: MstProviderKeySnapshot = yield toMstSnapshot(entry, secretStore);
        self.root.upsertProviderKey(mstEntry);

        // Sync auth profiles and proxy config (provider already in config from startup)
        yield syncAuthAndProxy();

        return { entry, shouldActivate };
      }),

      /**
       * Update fields on an existing provider key.
       */
      updateKey: flow(function* (id: string, fields: {
        label?: string;
        model?: string;
        apiKey?: string;
        proxyUrl?: string;
        baseUrl?: string;
        inputModalities?: string[];
        customModelsJson?: string;
      }) {
        const { storage, secretStore, syncActiveKey, toMstSnapshot } = getEnvDeps();

        const existing = storage.providerKeys.getById(id);
        if (!existing) throw new Error("Provider key not found");

        // Keychain (if apiKey provided)
        if (fields.apiKey) {
          yield secretStore.set(`provider-key-${id}`, fields.apiKey);
          if (existing.isDefault) {
            yield syncActiveKey(existing.provider, storage, secretStore);
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
        const proxyChanged = proxyBaseUrl !== undefined && proxyBaseUrl !== existing.proxyBaseUrl;

        // SQLite
        const updated = storage.providerKeys.update(id, {
          label: fields.label,
          model: fields.model,
          proxyBaseUrl,
          baseUrl: fields.baseUrl,
          inputModalities: fields.inputModalities,
          customModelsJson: fields.customModelsJson,
        });

        // MST state
        if (updated) {
          const mstEntry: MstProviderKeySnapshot = yield toMstSnapshot(updated, secretStore);
          self.root.upsertProviderKey(mstEntry);
        }

        // Sync auth profiles and proxy config for API key and proxy changes
        if (fields.apiKey || proxyChanged) {
          yield syncAuthAndProxy();
        }

        // If active key and model/proxy changed: patch sessions + update config
        if (existing.isDefault && proxyChanged) {
          yield syncAuthAndProxy();
        }

        return { updated, existing, modelChanging };
      }),

      /**
       * Delete a provider key and handle promotion.
       */
      deleteKey: flow(function* (id: string) {
        const { storage, secretStore, syncActiveKey, allKeysToMstSnapshots } = getEnvDeps();

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
            self.activeKeyId = remaining[0].id;
          } else {
            storage.settings.set("llm-provider", "");
            self.activeKeyId = null;
          }
        }

        // Canonical secrets
        yield syncActiveKey(existing.provider, storage, secretStore);
        if (promotedKey && promotedKey.provider !== existing.provider) {
          yield syncActiveKey(promotedKey.provider, storage, secretStore);
        }

        // MST state (reload all — isDefault may have shifted)
        const mstKeys: MstProviderKeySnapshot[] = yield allKeysToMstSnapshots(
          storage.providerKeys.getAll(),
          secretStore,
        );
        self.root.loadProviderKeys(mstKeys);

        // Sync auth profiles and proxy config (provider stays in config until restart)
        yield syncAuthAndProxy();

        return { existing, promotedKey };
      }),

      /**
       * Refresh custom models for a provider key.
       */
      refreshModels: flow(function* (id: string, models: string[]) {
        const { storage, secretStore, toMstSnapshot } = getEnvDeps();

        const updated = storage.providerKeys.update(id, {
          customModelsJson: JSON.stringify(models),
        });

        // MST state
        if (updated) {
          const mstEntry: MstProviderKeySnapshot = yield toMstSnapshot(updated, secretStore);
          self.root.upsertProviderKey(mstEntry);
        }

        // Sync auth profiles (models list changed but provider config written at startup)
        if (updated?.isDefault) {
          yield syncAuthAndProxy();
        }

        return updated;
      }),

      /**
       * Sync cloud provider key from user auth state (login/logout/key rotation).
       */
      syncCloud: flow(function* (user: { llmKey?: { key: string } | null } | null) {
        const { storage, secretStore, syncActiveKey, toMstSnapshot, allKeysToMstSnapshots } = getEnvDeps();

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

            let promotedKey: ProviderKeyEntry | undefined;
            if (wasDefault) {
              const remaining = storage.providerKeys.getAll();
              if (remaining.length > 0) {
                storage.providerKeys.setDefault(remaining[0].id);
                storage.settings.set("llm-provider", remaining[0].provider);
                yield syncActiveKey(remaining[0].provider, storage, secretStore);
                promotedKey = remaining[0];
                self.activeKeyId = remaining[0].id;
              } else {
                storage.settings.set("llm-provider", "");
                self.activeKeyId = null;
              }
            }
            yield syncActiveKey(CLOUD_PROVIDER_ID, storage, secretStore);

            // MST state (reload all — isDefault may have shifted)
            const mstKeys: MstProviderKeySnapshot[] = yield allKeysToMstSnapshots(
              storage.providerKeys.getAll(),
              secretStore,
            );
            self.root.loadProviderKeys(mstKeys);

            // Sync auth + proxy + full config (cloud provider removed)
            yield syncAuthProxyAndConfig();

            log.info("Removed cloud provider key (user logged out or key absent)");
          }
          return;
        }

        // User has llmKey — upsert
        if (existing) {
          const currentBaseUrl = `${getApiBaseUrl("en")}/llm/v1`;
          const currentKey: string | null = yield secretStore.get(`provider-key-${existing.id}`);
          const keyChanged = currentKey !== llmKey;
          const baseUrlChanged = existing.baseUrl !== currentBaseUrl;

          if (!keyChanged && !baseUrlChanged) {
            log.info("Cloud provider key unchanged, skipping sync");
            return;
          }

          // Update secret if changed
          if (keyChanged) {
            yield secretStore.set(`provider-key-${existing.id}`, llmKey);
            if (existing.isDefault) {
              yield syncActiveKey(CLOUD_PROVIDER_ID, storage, secretStore);
            }
          }

          // Update baseUrl if environment changed (e.g., staging vs production)
          if (baseUrlChanged) {
            storage.providerKeys.update(existing.id, { baseUrl: currentBaseUrl });
            log.info(`Updated cloud provider baseUrl: ${existing.baseUrl} -> ${currentBaseUrl}`);
          }

          // MST state
          const freshEntry = storage.providerKeys.getById(existing.id)!;
          const mstEntry: MstProviderKeySnapshot = yield toMstSnapshot(freshEntry, secretStore);
          self.root.upsertProviderKey(mstEntry);

          // Sync auth profiles + config (baseUrl change needs config rewrite)
          if (baseUrlChanged) {
            yield syncAuthProxyAndConfig();
          } else {
            yield syncAuthAndProxy();
          }

          log.info("Updated cloud provider key secret (rotated)");
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
          self.activeKeyId = entry.id;
        }
        yield syncActiveKey(CLOUD_PROVIDER_ID, storage, secretStore);

        // MST state
        const mstEntry: MstProviderKeySnapshot = yield toMstSnapshot(entry, secretStore);
        self.root.upsertProviderKey(mstEntry);

        // Sync auth + proxy + full config (new cloud provider added)
        yield syncAuthProxyAndConfig();

        // Full gateway restart — plugins (including cloud-tools) need to re-initialize
        // to discover the new provider and fetch dynamic tools from backend.
        const { restartGateway } = getEnvDeps();
        restartGateway().catch((err: unknown) => {
          log.warn("Gateway restart after cloud key creation failed (best-effort):", err);
        });

        log.info(`Created cloud provider key (activated: ${shouldActivate})`);
      }),
    };
  });

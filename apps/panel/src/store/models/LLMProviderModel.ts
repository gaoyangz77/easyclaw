import { types, flow, getRoot } from "mobx-state-tree";
import { fetchJson } from "../../api/client.js";
import { fetchModelCatalog, type CatalogModelEntry } from "../../api/providers.js";
import { API, clientPath } from "@rivonclaw/core/api-contract";

export interface SwitchModelResult {
  contextWarning?: { currentTokens: number; newContextWindow: number };
}

export interface SessionModelInfo {
  provider: string;
  model: string;
  modelName: string;
  isOverridden: boolean;
  contextWindow: number | null;
  contextTokens: number | null;
}

/** Fired after any global model or provider change. */
const CONFIG_CHANGED_EVENT = "config-changed";

/**
 * LLM provider/model operations as MST actions on the Panel entity store.
 *
 * Holds a volatile `catalog` property (the full model catalog from all providers),
 * which is refreshed automatically when provider config changes.
 *
 * `switchModel` and `activateProvider` delegate to ProviderKeyModel actions
 * (accessed via `getRoot`), which issue REST calls to Desktop.
 */
export const LLMProviderModel = types
  .model("LLMProvider", {})
  .volatile(() => ({
    /** Full model catalog: provider -> model list. Populated by refreshCatalog. */
    catalog: {} as Record<string, CatalogModelEntry[]>,
    /** True once the first catalog fetch has completed. */
    catalogReady: false,
  }))
  .actions((self) => {
    /** Broadcast config change to all listeners. */
    function broadcast(): void {
      window.dispatchEvent(new CustomEvent(CONFIG_CHANGED_EVENT));
    }

    /** Handler for config-changed events — refreshes catalog. */
    function onConfigChanged(): void {
      // Fire-and-forget: re-fetch catalog when provider config changes
      fetchModelCatalog()
        .then((data) => { self.catalog = data; self.catalogReady = true; })
        .catch(() => {});
    }

    return {
      afterCreate() {
        // Auto-refresh catalog when provider config changes (model switch, provider activation, etc.)
        window.addEventListener(CONFIG_CHANGED_EVENT, onConfigChanged);
      },

      beforeDestroy() {
        window.removeEventListener(CONFIG_CHANGED_EVENT, onConfigChanged);
      },

      /** Fetch (or re-fetch) the full model catalog from Desktop. */
      refreshCatalog: flow(function* () {
        try {
          const data: Record<string, CatalogModelEntry[]> = yield fetchModelCatalog();
          self.catalog = data;
          self.catalogReady = true;
        } catch {
          // Non-fatal — catalog may not be available before gateway starts
        }
      }),

      /** Switch the global default model on a provider key (affects new sessions only). */
      switchModel: flow(function* (
        keyId: string,
        model: string,
      ): Generator<Promise<unknown>, SwitchModelResult, any> {
        const root = getRoot(self) as any;
        const key = root.providerKeys.find((k: any) => k.id === keyId);
        if (!key) throw new Error(`Provider key ${keyId} not found`);
        const result = yield key.update({ model });
        broadcast();
        const response = result as Record<string, unknown>;
        const warning = response.contextWarning as SwitchModelResult["contextWarning"];
        return { contextWarning: warning };
      }),

      /** Activate a provider key as the global default. */
      activateProvider: flow(function* (keyId: string) {
        const root = getRoot(self) as any;
        const key = root.providerKeys.find((k: any) => k.id === keyId);
        if (!key) throw new Error(`Provider key ${keyId} not found`);
        yield key.activate();
        broadcast();
      }),

      /** Switch model for a specific session (does not affect global default). */
      switchSessionModel: flow(function* (sessionKey: string, provider: string, model: string) {
        yield fetchJson(clientPath(API["sessionModel.set"]), {
          method: "PUT",
          body: JSON.stringify({ sessionKey, provider, model }),
        });
      }),

      /** Reset a session to follow the global default model. */
      resetSessionModel: flow(function* (sessionKey: string) {
        yield fetchJson(clientPath(API["sessionModel.set"]), {
          method: "PUT",
          body: JSON.stringify({ sessionKey, provider: "", model: "" }),
        });
      }),

      /** Get the effective model info for a session.
       *  Resolved by LLMProviderManager on Desktop: session override -> global default.
       *  Returns null if no provider key is configured. */
      getSessionModelInfo: flow(function* (
        sessionKey: string,
      ): Generator<Promise<unknown>, SessionModelInfo | null, any> {
        const info: { provider: string; model: string; isOverridden: boolean } | null =
          yield fetchJson(clientPath(API["sessionModel.get"]) + `?sessionKey=${encodeURIComponent(sessionKey)}`);
        if (!info?.provider) return null;

        // Catalog lookup stays client-side (display name + effective context budget).
        // Use the cached catalog if available, otherwise fetch fresh.
        let catalog = self.catalog;
        if (!self.catalogReady || Object.keys(catalog).length === 0) {
          catalog = yield fetchModelCatalog();
          self.catalog = catalog;
          self.catalogReady = true;
        }
        const models = catalog[info.provider] ?? [];
        const match = models.find((m) => m.id === info.model);

        return {
          provider: info.provider,
          model: info.model,
          modelName: match?.name ?? info.model,
          isOverridden: info.isOverridden,
          contextWindow: match?.contextTokens ?? match?.contextWindow ?? null,
          contextTokens: match?.contextTokens ?? null,
        };
      }),

      /** Broadcast config change to all listeners (for cross-page coordination). */
      broadcast,

      /** Subscribe to config changes. Returns cleanup function. */
      onChange(callback: () => void): () => void {
        window.addEventListener(CONFIG_CHANGED_EVENT, callback);
        return () => window.removeEventListener(CONFIG_CHANGED_EVENT, callback);
      },
    };
  });

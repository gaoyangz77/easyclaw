import { updateProviderKey, activateProviderKey, updateSettings, fetchActiveKeyUsage, fetchModelCatalog } from "../api/index.js";
import type { ActiveKeyInfo, CatalogModelEntry } from "../api/index.js";

/** Fired after any model or provider change. */
const CONFIG_CHANGED_EVENT = "config-changed";

class ConfigManager {
  /** Switch model on a provider key. Triggers gateway restart server-side. */
  async switchModel(keyId: string, model: string): Promise<void> {
    await updateProviderKey(keyId, { model });
    this.broadcast();
  }

  /** Activate a provider key + set it as the active provider. */
  async activateProvider(keyId: string, provider: string): Promise<void> {
    await activateProviderKey(keyId);
    await updateSettings({ "llm-provider": provider });
    this.broadcast();
  }

  /** Get the current active key info. */
  async getActiveKey(): Promise<ActiveKeyInfo | null> {
    return fetchActiveKeyUsage();
  }

  /** Get model catalog for a specific provider. */
  async getModelsForProvider(provider: string): Promise<CatalogModelEntry[]> {
    const catalog = await fetchModelCatalog();
    return catalog[provider] ?? [];
  }

  /** Broadcast config change to all listeners. */
  private broadcast(): void {
    window.dispatchEvent(new CustomEvent(CONFIG_CHANGED_EVENT));
  }

  /** Subscribe to config changes. Returns cleanup function. */
  onChange(callback: () => void): () => void {
    window.addEventListener(CONFIG_CHANGED_EVENT, callback);
    return () => window.removeEventListener(CONFIG_CHANGED_EVENT, callback);
  }
}

export const configManager = new ConfigManager();

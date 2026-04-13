import { useState, useEffect, useRef } from "react";
import type { SessionTabInfo } from "../chat-utils.js";
import { checkContextOverflow } from "../chat-utils.js";
import { formatError } from "@rivonclaw/core";
import { trackEvent } from "../../../api/index.js";
import { useEntityStore } from "../../../store/EntityStoreProvider.js";
import { useToast } from "../../../components/Toast.js";
import { useTranslation } from "react-i18next";

export interface ActiveModelInfo {
  provider: string;
  model: string;
  isOverridden: boolean;
  contextWindow: number | null;
}

export interface UseChatModelControlsParams {
  sessionKeyRef: React.RefObject<string>;
  connectionState: string;
  sessions: SessionTabInfo[];
  activeSessionKey: string;
  onOverflowClear: () => void;
}

export function useChatModelControls({
  sessionKeyRef,
  connectionState,
  sessions,
  activeSessionKey,
  onOverflowClear,
}: UseChatModelControlsParams) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const entityStore = useEntityStore();

  const [activeModel, setActiveModel] = useState<ActiveModelInfo | null>(null);
  const [hasProviderKeys, setHasProviderKeys] = useState(true);
  const [pendingModelSwitch, setPendingModelSwitch] = useState<{
    provider: string;
    model: string;
    currentTokens: number;
    newContextWindow: number;
  } | null>(null);

  /** Generation counter for refreshModel -- prevents stale async results from
   *  overwriting newer state (Bug 3 fix -- race condition). */
  const modelRefreshGenRef = useRef(0);

  /** Fetch model info for the given session and update state. */
  function refreshModel(sessionKey: string) {
    const gen = ++modelRefreshGenRef.current;
    (async () => {
      const info = await entityStore.llmManager.getSessionModelInfo(sessionKey);
      // Stale result -- a newer refresh was triggered while we were awaiting
      if (gen !== modelRefreshGenRef.current) return;
      if (!info) {
        setActiveModel(null);
        setHasProviderKeys(entityStore.providerKeys.length > 0);
        return;
      }
      setHasProviderKeys(true);
      setActiveModel({
        provider: info.provider,
        model: info.model,
        isOverridden: info.isOverridden,
        contextWindow: info.contextWindow,
      });
      // Ensure catalog is populated (getSessionModelInfo already populates it
      // if not yet ready, but trigger a refresh for full coverage)
      if (!entityStore.llmManager.catalogReady) {
        await entityStore.llmManager.refreshCatalog();
      }
    })().catch(() => {
      if (gen !== modelRefreshGenRef.current) return;
      setActiveModel(null);
    });
  }

  // Fetch active model info when connection state changes to connected
  useEffect(() => {
    if (connectionState === "connected") refreshModel(sessionKeyRef.current);
  }, [connectionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh model info when config changes (e.g. model switched from ProvidersPage)
  useEffect(() => {
    return entityStore.llmManager.onChange(() => refreshModel(sessionKeyRef.current));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Execute a per-session model switch via llmManager (does NOT affect other sessions). */
  function doModelSwitch(provider: string, model: string) {
    if (!provider) return;
    const oldModel = activeModel ? { ...activeModel } : null;
    trackEvent("chat.model_switched", { provider, model });

    // Optimistic UI update -- update provider, model, isOverridden, and contextWindow
    const models = entityStore.llmManager.catalog[provider] ?? [];
    const match = models.find((m) => m.id === model);
    setActiveModel((prev) => prev ? {
      ...prev,
      provider,
      model,
      isOverridden: true,
      contextWindow: match?.contextWindow ?? null,
    } : null);

    // Delegate the actual API call to llmManager
    entityStore.llmManager.switchSessionModel(sessionKeyRef.current, provider, model).catch((err) => {
      // Rollback entire optimistic state including isOverridden (Bug 2 fix)
      setActiveModel(oldModel);
      const errText = formatError(err) || t("chat.unknownError");
      showToast(errText, "error");
    });
  }

  async function handleKeyModelChange(newProvider: string, newModel: string) {
    if (!activeModel) return;

    // "Follow global default" -- reset session override, refresh to show global default
    if (!newProvider && !newModel) {
      setActiveModel((prev) => prev ? { ...prev, isOverridden: false } : null);
      entityStore.llmManager.resetSessionModel(sessionKeyRef.current).catch(() => {});
      refreshModel(sessionKeyRef.current);
      return;
    }

    // Skip only if same model AND already explicitly locked (not just following default)
    if (newProvider === activeModel.provider && newModel === activeModel.model && activeModel.isOverridden) return;

    // Pre-flight: look up the new model's context window from catalog
    // Bug 1 fix: read currentTokens fresh from sessions to avoid
    // stale closure over activeSessionTab which is computed during render.
    const freshTab = sessions.find((s) => s.key === activeSessionKey);
    const currentTokens = freshTab?.totalTokens ?? 0;
    if (currentTokens > 0) {
      try {
        const providerModels = entityStore.llmManager.catalog[newProvider] ?? [];
        const newModelEntry = providerModels.find((m) => m.id === newModel);
        const result = checkContextOverflow(currentTokens, newModelEntry?.contextWindow);
        if (result.action === "block") {
          setPendingModelSwitch({
            provider: newProvider,
            model: newModel,
            currentTokens: result.currentTokens,
            newContextWindow: result.newContextWindow,
          });
          return;
        }
      } catch {
        // Catalog lookup failed -- proceed with the switch, API-level warning handles it
      }
    }

    // Scenario B (approaching) & normal: proceed with switch
    doModelSwitch(newProvider, newModel);
  }

  function handleOverflowContinue() {
    if (!pendingModelSwitch) return;
    // Switch model -- session persists (no restart), OpenClaw auto-compacts on next run
    doModelSwitch(pendingModelSwitch.provider, pendingModelSwitch.model);
    setPendingModelSwitch(null);
  }

  async function handleOverflowClear() {
    if (!pendingModelSwitch) return;
    doModelSwitch(pendingModelSwitch.provider, pendingModelSwitch.model);
    setPendingModelSwitch(null);
    onOverflowClear();
  }

  return {
    activeModel,
    hasProviderKeys,
    pendingModelSwitch,
    setPendingModelSwitch,
    refreshModel,
    doModelSwitch,
    handleKeyModelChange,
    handleOverflowContinue,
    handleOverflowClear,
  };
}

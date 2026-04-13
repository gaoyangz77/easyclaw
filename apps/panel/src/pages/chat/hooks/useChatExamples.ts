import { useState, useEffect, useMemo } from "react";
import { reaction } from "mobx";
import { useTranslation } from "react-i18next";
import { useChatPreferenceStore } from "../ChatPreferenceStoreProvider.js";
import { useEntityStore } from "../../../store/EntityStoreProvider.js";
import { fetchSettings, updateSettings } from "../../../api/index.js";
import { EXAMPLE_KEYS, getPresetExamples } from "../store/chat-example-presets.js";

/**
 * Persisted format for `chat-example-prompts` setting:
 *   - Legacy: flat `Record<ExampleKey, string>` (treated as overrides for "default" preset)
 *   - New:    `{ overridesByPreset: Record<presetId, Record<ExampleKey, string>> }`
 */
interface NewOverridesFormat {
  overridesByPreset: Record<string, Record<string, string>>;
}

function isNewFormat(parsed: unknown): parsed is NewOverridesFormat {
  return typeof parsed === "object" && parsed !== null && "overridesByPreset" in parsed;
}

/**
 * Chat example prompts — reactive bridge between ChatPreferenceStore,
 * entityStore module enrollment, and i18n.
 *
 * These are the 6 customizable quick-send message templates shown below
 * the chat input. They are NOT session-scoped state and do NOT belong
 * in ChatStore. Source: ChatPreferenceStore + settings API + localStorage.
 */
export function useChatExamples() {
  const { t, i18n } = useTranslation();
  const prefStore = useChatPreferenceStore();
  const entityStore = useEntityStore();

  const [editingExample, setEditingExample] = useState<string | null>(null);
  const [editingExampleDraft, setEditingExampleDraft] = useState("");
  // Pin the preset that was active when the edit modal opened, so save/restore
  // writes to the correct preset even if activePresetId changes mid-edit.
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);

  // --- Auto-switch preset based on module enrollment ---
  useEffect(() => {
    const dispose = reaction(
      () => entityStore.isModuleEnrolled("GLOBAL_ECOMMERCE_SELLER"),
      (isEcommerce) => {
        prefStore.setActivePresetId(isEcommerce ? "ecommerce" : "default");
      },
      { fireImmediately: true },
    );
    return dispose;
  }, [entityStore, prefStore]);

  // --- Load overrides from settings on mount ---
  useEffect(() => {
    fetchSettings().then((s) => {
      try {
        const raw = s["chat-example-prompts"];
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (isNewFormat(parsed)) {
          prefStore.loadOverrides(parsed.overridesByPreset);
        } else if (typeof parsed === "object" && parsed !== null) {
          // Legacy flat format: copy overrides to both "default" and the
          // current active preset so the user's customizations remain visible
          // regardless of which preset is active after migration.
          const flat = parsed as Record<string, string>;
          const activeId = prefStore.activePresetId;
          const migrated: Record<string, Record<string, string>> = { default: flat };
          if (activeId !== "default") {
            migrated[activeId] = { ...flat };
          }
          prefStore.loadOverrides(migrated);
        }
      } catch { /* ignore invalid JSON */ }

      // Load collapsed state from settings (synced across devices)
      const collapsed = s["chat_examples_collapsed"];
      if (collapsed !== undefined) {
        prefStore.setExpanded(collapsed !== "1");
      }
    }).catch(() => {});
  }, [prefStore]);

  // --- Resolve examples: override -> preset default -> i18n fallback ---
  const activeOverrides = prefStore.activeOverrides;
  const activePresetId = prefStore.activePresetId;
  const lang = i18n.language;

  const resolvedExamples = useMemo(() => {
    const presetTexts = getPresetExamples(activePresetId, lang);
    const result: Record<string, string> = {};
    for (const key of EXAMPLE_KEYS) {
      result[key] = activeOverrides[key] ?? presetTexts?.[key] ?? t(`chat.${key}`);
    }
    return result;
  }, [activeOverrides, activePresetId, lang, t]);

  // --- Persist helpers ---

  function persistOverrides() {
    const allOverrides: Record<string, Record<string, string>> = {};
    for (const [presetId, map] of prefStore.overridesByPreset) {
      const obj: Record<string, string> = {};
      for (const [k, v] of map) obj[k] = v;
      if (Object.keys(obj).length > 0) allOverrides[presetId] = obj;
    }
    const payload: NewOverridesFormat = { overridesByPreset: allOverrides };
    const hasAny = Object.keys(allOverrides).length > 0;
    updateSettings({
      "chat-example-prompts": hasAny ? JSON.stringify(payload) : "",
    }).catch(() => {});
  }

  function toggleExpanded() {
    const next = !prefStore.chatExamplesExpanded;
    prefStore.setExpanded(next);
    localStorage.setItem("chat-examples-collapsed", next ? "0" : "1");
    updateSettings({ chat_examples_collapsed: next ? "0" : "1" }).catch(() => {});
  }

  /** Begin editing — pin the current preset so mid-edit preset changes don't misroute. */
  function beginEdit(key: string, currentText: string) {
    setEditingExample(key);
    setEditingExampleDraft(currentText);
    setEditingPresetId(prefStore.activePresetId);
  }

  function saveExample(key: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const targetPreset = editingPresetId ?? prefStore.activePresetId;
    prefStore.setOverrideForPreset(targetPreset, key, trimmed);
    persistOverrides();
    setEditingExample(null);
    setEditingPresetId(null);
  }

  function restoreDefault(key: string) {
    const targetPreset = editingPresetId ?? prefStore.activePresetId;
    prefStore.clearOverrideForPreset(targetPreset, key);
    persistOverrides();
    setEditingExample(null);
    setEditingPresetId(null);
  }

  function cancelEdit() {
    setEditingExample(null);
    setEditingPresetId(null);
  }

  return {
    chatExamplesExpanded: prefStore.chatExamplesExpanded,
    resolvedExamples,
    customExamples: activeOverrides,
    editingExample,
    editingExampleDraft,
    setEditingExampleDraft,
    beginEdit,
    cancelEdit,
    toggleExpanded,
    saveExample,
    restoreDefault,
  };
}

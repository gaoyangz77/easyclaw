import { types, type Instance } from "mobx-state-tree";

/**
 * ChatPreferenceStore — chat feature-level preference state.
 *
 * NOT session-scoped. Holds:
 *   - Example prompt presets, user overrides, and expanded/collapsed state
 *
 * Separate from ChatStore (which holds per-session state) because examples
 * are a feature-level UI/settings concern shared across all sessions.
 */
export const ChatPreferenceStoreModel = types
  .model("ChatPreferenceStore", {
    chatExamplesExpanded: true,
    activePresetId: "default",
    /** Per-preset user overrides. Key: presetId, Value: map of exampleKey -> custom text. */
    overridesByPreset: types.map(types.map(types.string)),
  })
  .views((self) => ({
    /** Get the user overrides map for the currently active preset as a plain object. */
    get activeOverrides(): Record<string, string> {
      const map = self.overridesByPreset.get(self.activePresetId);
      if (!map) return {};
      const result: Record<string, string> = {};
      for (const [k, v] of map) result[k] = v;
      return result;
    },
  }))
  .actions((self) => ({
    setExpanded(v: boolean) {
      self.chatExamplesExpanded = v;
    },
    setActivePresetId(id: string) {
      self.activePresetId = id;
    },
    /** Set an override for a specific preset (used when editing targets a pinned preset). */
    setOverrideForPreset(presetId: string, key: string, text: string) {
      let presetMap = self.overridesByPreset.get(presetId);
      if (!presetMap) {
        self.overridesByPreset.set(presetId, {});
        presetMap = self.overridesByPreset.get(presetId)!;
      }
      presetMap.set(key, text);
    },
    /** Clear an override for a specific preset. */
    clearOverrideForPreset(presetId: string, key: string) {
      const presetMap = self.overridesByPreset.get(presetId);
      if (presetMap) presetMap.delete(key);
    },
    /** Bulk load per-preset overrides from settings (on init). */
    loadOverrides(data: Record<string, Record<string, string>>) {
      self.overridesByPreset.clear();
      for (const [presetId, overrides] of Object.entries(data)) {
        self.overridesByPreset.set(presetId, overrides);
      }
    },
  }));

export type IChatPreferenceStore = Instance<typeof ChatPreferenceStoreModel>;

export function createChatPreferenceStore(): IChatPreferenceStore {
  // Sync-read localStorage for instant collapsed state (no flash).
  // Settings API load in useChatExamples provides cross-device sync later.
  const collapsed = typeof localStorage !== "undefined"
    && localStorage.getItem("chat-examples-collapsed") === "1";
  return ChatPreferenceStoreModel.create({
    chatExamplesExpanded: !collapsed,
  });
}

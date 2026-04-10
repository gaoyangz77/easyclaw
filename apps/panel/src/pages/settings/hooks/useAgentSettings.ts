import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent, fetchAgentSettings, updateAgentSettings } from "../../../api/index.js";
import { useToast } from "../../../components/Toast.js";

export function useAgentSettings() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [dmScope, setDmScope] = useState("main");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadSettings() {
    try {
      setLoading(true);
      const agentSettings = await fetchAgentSettings();
      setDmScope(agentSettings.dmScope);
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSettings(); }, []);

  async function handleDmScopeChange(value: string) {
    const previous = dmScope;
    setDmScope(value);
    try {
      setSaving(true);
      await updateAgentSettings({ dmScope: value });
      trackEvent("settings.dm_scope_changed", { scope: value });
    } catch (err) {
      showToast(t("settings.agent.failedToSave") + String(err), "error");
      setDmScope(previous);
    } finally {
      setSaving(false);
    }
  }

  return { dmScope, loading, saving, handleDmScopeChange };
}

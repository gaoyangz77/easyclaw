import { useState } from "react";
import { DEFAULTS } from "@rivonclaw/core";
import { trackEvent, updateSettings } from "../../../api/index.js";

export function useAppearanceSettings() {
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem("accentColor") || "blue");
  const [tutorialEnabled, setTutorialEnabled] = useState(() => {
    const stored = localStorage.getItem("tutorial.enabled");
    if (stored === null) return DEFAULTS.settings.tutorialEnabled;
    return stored === "true";
  });
  const [showAgentName, setShowAgentName] = useState(() => {
    const stored = localStorage.getItem("showAgentName");
    if (stored === null) return DEFAULTS.settings.showAgentName;
    return stored === "true";
  });

  function handleAccentColorChange(color: string) {
    setAccentColor(color);
    localStorage.setItem("accentColor", color);
    updateSettings({ panel_accent: color }).catch(() => {});
    window.dispatchEvent(new CustomEvent("accent-color-changed"));
    trackEvent("settings.accent_color_changed", { color });
  }

  function handleToggleTutorial(enabled: boolean) {
    localStorage.setItem("tutorial.enabled", String(enabled));
    updateSettings({ tutorial_enabled: String(enabled) }).catch(() => {});
    setTutorialEnabled(enabled);
    window.dispatchEvent(new CustomEvent("tutorial-settings-changed"));
  }

  function handleToggleShowAgentName(enabled: boolean) {
    localStorage.setItem("showAgentName", String(enabled));
    updateSettings({ show_agent_name: String(enabled) }).catch(() => {});
    setShowAgentName(enabled);
    window.dispatchEvent(new CustomEvent("brand-display-changed"));
  }

  return {
    accentColor,
    tutorialEnabled,
    showAgentName,
    handleAccentColorChange,
    handleToggleTutorial,
    handleToggleShowAgentName,
  };
}

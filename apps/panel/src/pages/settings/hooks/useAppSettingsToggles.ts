import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent } from "../../../api/index.js";
import { useToast } from "../../../components/Toast.js";
import { useRuntimeStatus } from "../../../store/RuntimeStatusProvider.js";

export function useAppSettingsToggles() {
  const { t } = useTranslation();
  const runtimeStatus = useRuntimeStatus();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [cdpConfirmOpen, setCdpConfirmOpen] = useState(false);

  const settingsReady = runtimeStatus.snapshotReceived;
  const telemetryEnabled = runtimeStatus.appSettings.telemetryEnabled;
  const showAgentEvents = runtimeStatus.appSettings.chatShowAgentEvents;
  const preserveToolEvents = runtimeStatus.appSettings.chatPreserveToolEvents;
  const collapseMessages = runtimeStatus.appSettings.chatCollapseMessages;
  const autoLaunchEnabled = runtimeStatus.appSettings.autoLaunchEnabled;
  const browserMode = runtimeStatus.appSettings.browserMode as "standalone" | "cdp";
  const sessionStateCdpEnabled = runtimeStatus.appSettings.sessionStateCdpEnabled;
  const privacyMode = runtimeStatus.appSettings.privacyMode;

  async function handleToggleShowAgentEvents(enabled: boolean) {
    try {
      setSaving(true);
      await runtimeStatus.appSettings.setChatShowAgentEvents(enabled);
    } catch (err) {
      showToast(t("settings.chat.failedToSave") + String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePreserveToolEvents(enabled: boolean) {
    try {
      setSaving(true);
      await runtimeStatus.appSettings.setChatPreserveToolEvents(enabled);
    } catch (err) {
      showToast(t("settings.chat.failedToSave") + String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleCollapseMessages(enabled: boolean) {
    try {
      setSaving(true);
      await runtimeStatus.appSettings.setChatCollapseMessages(enabled);
    } catch (err) {
      showToast(t("settings.chat.failedToSave") + String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleTelemetry(enabled: boolean) {
    try {
      setSaving(true);
      await runtimeStatus.appSettings.setTelemetryEnabled(enabled);
      trackEvent("telemetry.toggled", { enabled });
    } catch (err) {
      showToast(t("settings.telemetry.failedToSave") + String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleAutoLaunch(enabled: boolean) {
    try {
      setSaving(true);
      await runtimeStatus.appSettings.setAutoLaunchEnabled(enabled);
      trackEvent("settings.auto_launch_toggled", { enabled });
    } catch (err) {
      showToast(t("settings.autoLaunch.failedToSave") + String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePrivacyMode(enabled: boolean) {
    try {
      setSaving(true);
      await runtimeStatus.appSettings.setPrivacyMode(enabled);
      trackEvent("settings.privacy_mode_toggled", { enabled });
    } catch (err) {
      showToast(t("settings.app.title") + ": " + String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleSessionStateCdp(enabled: boolean) {
    try {
      setSaving(true);
      await runtimeStatus.appSettings.setSessionStateCdpEnabled(enabled);
      trackEvent("settings.session_state_cdp_toggled", { enabled });
    } catch (err) {
      showToast(t("settings.browser.failedToSave") + String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  function handleBrowserModeChange(value: string) {
    const newMode = value as "standalone" | "cdp";
    if (newMode === "cdp" && browserMode !== "cdp") {
      setCdpConfirmOpen(true);
      return;
    }
    applyBrowserMode(newMode);
  }

  async function applyBrowserMode(newMode: "standalone" | "cdp") {
    try {
      setSaving(true);
      await runtimeStatus.appSettings.setBrowserMode(newMode);
      trackEvent("settings.browser_mode_changed", { mode: newMode });
    } catch (err) {
      showToast(t("settings.browser.failedToSave") + String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  return {
    saving,
    settingsReady,
    telemetryEnabled,
    showAgentEvents,
    preserveToolEvents,
    collapseMessages,
    autoLaunchEnabled,
    browserMode,
    sessionStateCdpEnabled,
    privacyMode,
    cdpConfirmOpen,
    setCdpConfirmOpen,
    handleToggleShowAgentEvents,
    handleTogglePreserveToolEvents,
    handleToggleCollapseMessages,
    handleToggleTelemetry,
    handleToggleAutoLaunch,
    handleTogglePrivacyMode,
    handleToggleSessionStateCdp,
    handleBrowserModeChange,
    applyBrowserMode,
  };
}

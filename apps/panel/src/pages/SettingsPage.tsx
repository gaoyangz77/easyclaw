import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fetchTelemetrySetting, updateTelemetrySetting, trackEvent, fetchAgentSettings, updateAgentSettings, fetchChatShowAgentEvents, updateChatShowAgentEvents, fetchChatPreserveToolEvents, updateChatPreserveToolEvents } from "../api.js";
import { Select } from "../components/Select.js";

const DM_SCOPE_OPTIONS = [
  { value: "main", labelKey: "settings.agent.dmScopeMain" },
  { value: "per-peer", labelKey: "settings.agent.dmScopePerPeer" },
  { value: "per-channel-peer", labelKey: "settings.agent.dmScopePerChannelPeer" },
  { value: "per-account-channel-peer", labelKey: "settings.agent.dmScopePerAccountChannelPeer" },
];

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle-switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span
        className={`toggle-track ${checked ? "toggle-track-on" : "toggle-track-off"} ${disabled ? "toggle-track-disabled" : ""}`}
      >
        <span
          className={`toggle-thumb ${checked ? "toggle-thumb-on" : "toggle-thumb-off"}`}
        />
      </span>
    </label>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [dmScope, setDmScope] = useState("main");
  const [showAgentEvents, setShowAgentEvents] = useState(false);
  const [preserveToolEvents, setPreserveToolEvents] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const [enabled, agentSettings, chatEvents, toolEvents] = await Promise.all([
        fetchTelemetrySetting(),
        fetchAgentSettings(),
        fetchChatShowAgentEvents(),
        fetchChatPreserveToolEvents(),
      ]);
      setTelemetryEnabled(enabled);
      setDmScope(agentSettings.dmScope);
      setShowAgentEvents(chatEvents);
      setPreserveToolEvents(toolEvents);
      setError(null);
    } catch (err) {
      setError(t("settings.agent.failedToLoad") + String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleDmScopeChange(value: string) {
    const previous = dmScope;
    setDmScope(value);
    try {
      setSaving(true);
      setError(null);
      await updateAgentSettings({ dmScope: value });
    } catch (err) {
      setError(t("settings.agent.failedToSave") + String(err));
      setDmScope(previous);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleShowAgentEvents(enabled: boolean) {
    const previous = showAgentEvents;
    setShowAgentEvents(enabled);
    try {
      setSaving(true);
      setError(null);
      await updateChatShowAgentEvents(enabled);
      window.dispatchEvent(new CustomEvent("chat-settings-changed"));
    } catch (err) {
      setError(t("settings.chat.failedToSave") + String(err));
      setShowAgentEvents(previous);
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePreserveToolEvents(enabled: boolean) {
    const previous = preserveToolEvents;
    setPreserveToolEvents(enabled);
    try {
      setSaving(true);
      setError(null);
      await updateChatPreserveToolEvents(enabled);
      window.dispatchEvent(new CustomEvent("chat-settings-changed"));
    } catch (err) {
      setError(t("settings.chat.failedToSave") + String(err));
      setPreserveToolEvents(previous);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleTelemetry(enabled: boolean) {
    try {
      setSaving(true);
      setError(null);
      await updateTelemetrySetting(enabled);
      setTelemetryEnabled(enabled);
      trackEvent("telemetry.toggled", { enabled });
    } catch (err) {
      setError(t("settings.telemetry.failedToSave") + String(err));
      setTelemetryEnabled(!enabled);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div>
        <h1>{t("settings.title")}</h1>
        <p>{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div>
      <h1>{t("settings.title")}</h1>
      <p className="page-description">{t("settings.description")}</p>

      {error && (
        <div className="error-alert">
          {error}
        </div>
      )}

      {/* Agent Settings Section */}
      <div className="section-card">
        <h3>{t("settings.agent.title")}</h3>

        <div>
          <label className="form-label-block">
            {t("settings.agent.dmScope")}
          </label>
          <Select
            value={dmScope}
            onChange={handleDmScopeChange}
            options={DM_SCOPE_OPTIONS.map(opt => ({
              value: opt.value,
              label: t(opt.labelKey),
            }))}
            disabled={saving}
          />
          <div className="form-hint">
            {t("settings.agent.dmScopeHint")}
          </div>
        </div>
      </div>

      {/* Chat Settings Section */}
      <div className="section-card">
        <h3>{t("settings.chat.title")}</h3>

        <div className="settings-toggle-card">
          <div className="settings-toggle-label">
            <span>{t("settings.chat.showAgentEvents")}</span>
            <ToggleSwitch checked={showAgentEvents} onChange={handleToggleShowAgentEvents} disabled={saving} />
          </div>
          <div className="form-hint">
            {t("settings.chat.showAgentEventsHint")}
          </div>
        </div>

        <div className="settings-toggle-card">
          <div className="settings-toggle-label">
            <span>{t("settings.chat.preserveToolEvents")}</span>
            <ToggleSwitch checked={preserveToolEvents} onChange={handleTogglePreserveToolEvents} disabled={saving} />
          </div>
          <div className="form-hint">
            {t("settings.chat.preserveToolEventsHint")}
          </div>
        </div>
      </div>

      {/* Telemetry & Privacy Section */}
      <div className="section-card">
        <h3>{t("settings.telemetry.title")}</h3>
        <p className="text-secondary">
          {t("settings.telemetry.description")}
        </p>

        <div className="settings-toggle-card">
          <div className="settings-toggle-label">
            <span>{t("settings.telemetry.toggle")}</span>
            <ToggleSwitch checked={telemetryEnabled} onChange={handleToggleTelemetry} disabled={saving} />
          </div>
        </div>

        <hr className="section-divider" />

        {/* What We Collect */}
        <div className="mb-md">
          <h3>
            {t("settings.telemetry.whatWeCollect")}
          </h3>
          <ul className="settings-list">
            <li>{t("settings.telemetry.collect.appLifecycle")}</li>
            <li>{t("settings.telemetry.collect.featureUsage")}</li>
            <li>{t("settings.telemetry.collect.errors")}</li>
            <li>{t("settings.telemetry.collect.runtime")}</li>
          </ul>
        </div>

        {/* What We DON'T Collect */}
        <div className="mb-md">
          <h3>
            {t("settings.telemetry.whatWeDontCollect")}
          </h3>
          <ul className="settings-list">
            <li>{t("settings.telemetry.dontCollect.conversations")}</li>
            <li>{t("settings.telemetry.dontCollect.apiKeys")}</li>
            <li>{t("settings.telemetry.dontCollect.ruleText")}</li>
            <li>{t("settings.telemetry.dontCollect.personalInfo")}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

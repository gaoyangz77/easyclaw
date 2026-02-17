import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fetchTelemetrySetting, updateTelemetrySetting, trackEvent, fetchAgentSettings, updateAgentSettings } from "../api.js";
import { Select } from "../components/Select.js";

const DM_SCOPE_OPTIONS = [
  { value: "main", labelKey: "settings.agent.dmScopeMain" },
  { value: "per-peer", labelKey: "settings.agent.dmScopePerPeer" },
  { value: "per-channel-peer", labelKey: "settings.agent.dmScopePerChannelPeer" },
  { value: "per-account-channel-peer", labelKey: "settings.agent.dmScopePerAccountChannelPeer" },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [dmScope, setDmScope] = useState("main");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const [enabled, agentSettings] = await Promise.all([
        fetchTelemetrySetting(),
        fetchAgentSettings(),
      ]);
      setTelemetryEnabled(enabled);
      setDmScope(agentSettings.dmScope);
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

      {/* Telemetry & Privacy Section */}
      <div className="section-card">
        <h3>{t("settings.telemetry.title")}</h3>
        <p className="text-secondary">
          {t("settings.telemetry.description")}
        </p>

        {/* Toggle Switch */}
        <div className="settings-toggle-card">
          <label className="settings-toggle-label">
            <input
              type="checkbox"
              checked={telemetryEnabled}
              onChange={(e) => handleToggleTelemetry(e.target.checked)}
              disabled={saving}
              style={{
                width: 20,
                height: 20,
                marginRight: 12,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            />
            {t("settings.telemetry.toggle")}
          </label>
          {saving && (
            <span className="text-sm text-secondary" style={{ marginLeft: 12 }}>
              {t("common.saving")}...
            </span>
          )}
        </div>

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

        {/* Privacy Policy Link */}
        <div className="settings-privacy-box">
          <span style={{ marginRight: 8 }}>ℹ️</span>
          {t("settings.telemetry.privacyNote")}{" "}
          <a
            href="https://easyclaw.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("settings.telemetry.learnMore")}
          </a>
        </div>
      </div>
    </div>
  );
}

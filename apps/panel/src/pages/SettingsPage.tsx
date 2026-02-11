import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fetchTelemetrySetting, updateTelemetrySetting, trackEvent } from "../api.js";

export function SettingsPage() {
  const { t } = useTranslation();
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const enabled = await fetchTelemetrySetting();
      setTelemetryEnabled(enabled);
      setError(null);
    } catch (err) {
      setError(t("settings.telemetry.failedToLoad") + String(err));
    } finally {
      setLoading(false);
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
      // Revert on error
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
      <p>{t("settings.description")}</p>

      {error && (
        <div className="error-alert" style={{ marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* Telemetry & Privacy Section */}
      <div className="section-card">
        <h3>{t("settings.telemetry.title")}</h3>
        <p style={{ marginBottom: 20, color: "#5f6368", lineHeight: 1.6 }}>
          {t("settings.telemetry.description")}
        </p>

        {/* Toggle Switch */}
        <div style={{
          display: "flex",
          alignItems: "center",
          padding: "16px 20px",
          backgroundColor: "#f8f9fa",
          borderRadius: 8,
          marginBottom: 20,
          border: "1px solid #e8eaed"
        }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              cursor: "pointer",
              flex: 1,
              fontSize: 15,
              fontWeight: 500,
            }}
          >
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
            <span style={{ fontSize: 13, color: "#5f6368", marginLeft: 12 }}>
              {t("common.saving")}...
            </span>
          )}
        </div>

        {/* What We Collect */}
        <div style={{ marginBottom: 20 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: "#202124" }}>
            {t("settings.telemetry.whatWeCollect")}
          </h4>
          <ul style={{ margin: 0, paddingLeft: 24, lineHeight: 1.8, color: "#5f6368" }}>
            <li>{t("settings.telemetry.collect.appLifecycle")}</li>
            <li>{t("settings.telemetry.collect.featureUsage")}</li>
            <li>{t("settings.telemetry.collect.errors")}</li>
            <li>{t("settings.telemetry.collect.runtime")}</li>
          </ul>
        </div>

        {/* What We DON'T Collect */}
        <div style={{ marginBottom: 20 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: "#202124" }}>
            {t("settings.telemetry.whatWeDontCollect")}
          </h4>
          <ul style={{ margin: 0, paddingLeft: 24, lineHeight: 1.8, color: "#5f6368" }}>
            <li>{t("settings.telemetry.dontCollect.conversations")}</li>
            <li>{t("settings.telemetry.dontCollect.apiKeys")}</li>
            <li>{t("settings.telemetry.dontCollect.ruleText")}</li>
            <li>{t("settings.telemetry.dontCollect.personalInfo")}</li>
          </ul>
        </div>

        {/* Privacy Policy Link */}
        <div style={{
          padding: "12px 16px",
          backgroundColor: "#e8f0fe",
          borderRadius: 6,
          fontSize: 13,
          color: "#1967d2"
        }}>
          <span style={{ marginRight: 8 }}>ℹ️</span>
          {t("settings.telemetry.privacyNote")}{" "}
          <a
            href="https://easyclaw.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#1967d2", textDecoration: "underline" }}
          >
            {t("settings.telemetry.learnMore")}
          </a>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { fetchTelemetrySetting, updateTelemetrySetting, trackEvent, fetchAgentSettings, updateAgentSettings, fetchChatShowAgentEvents, updateChatShowAgentEvents, fetchChatPreserveToolEvents, updateChatPreserveToolEvents, fetchChatCollapseMessages, updateChatCollapseMessages, fetchBrowserMode, updateBrowserMode, fetchAutoLaunchSetting, updateAutoLaunchSetting, fetchOpenClawStateDir, updateOpenClawStateDir, resetOpenClawStateDir, fetchPrivacyMode, updatePrivacyMode, fetchSessionStateCdpEnabled, updateSessionStateCdpEnabled } from "../api/index.js";
import type { OpenClawStateDirInfo } from "../api/index.js";
import { Select } from "../components/inputs/Select.js";
import { ConfirmDialog } from "../components/modals/ConfirmDialog.js";

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
  const [collapseMessages, setCollapseMessages] = useState(true);
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false);
  const [browserMode, setBrowserMode] = useState<"standalone" | "cdp">("standalone");
  const [sessionStateCdpEnabled, setSessionStateCdpEnabled] = useState(true);
  const [cdpConfirmOpen, setCdpConfirmOpen] = useState(false);
  const [dataDirInfo, setDataDirInfo] = useState<OpenClawStateDirInfo | null>(null);
  const [dataDirRestartNeeded, setDataDirRestartNeeded] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doctorStatus, setDoctorStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [doctorOutput, setDoctorOutput] = useState<string[]>([]);
  const [doctorExitCode, setDoctorExitCode] = useState<number | null>(null);
  const doctorOutputRef = useRef<HTMLPreElement>(null);
  const doctorSseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (doctorOutputRef.current) {
      doctorOutputRef.current.scrollTop = doctorOutputRef.current.scrollHeight;
    }
  }, [doctorOutput]);

  useEffect(() => {
    return () => {
      doctorSseRef.current?.close();
    };
  }, []);

  const runDoctor = useCallback((fix: boolean) => {
    doctorSseRef.current?.close();
    setDoctorStatus("running");
    setDoctorOutput([]);
    setDoctorExitCode(null);

    const sse = new EventSource(`/api/doctor/run${fix ? "?fix=true" : ""}`);
    doctorSseRef.current = sse;

    sse.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "output") {
        setDoctorOutput(prev => [...prev, data.text]);
      } else if (data.type === "done") {
        setDoctorExitCode(data.exitCode);
        setDoctorStatus(data.exitCode === 0 ? "done" : "error");
        sse.close();
        doctorSseRef.current = null;
      } else if (data.type === "error") {
        setDoctorOutput(prev => [...prev, `ERROR: ${data.message}`]);
        setDoctorStatus("error");
        sse.close();
        doctorSseRef.current = null;
      }
    };

    sse.onerror = () => {
      setDoctorStatus("error");
      sse.close();
      doctorSseRef.current = null;
    };
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const [enabled, agentSettings, chatEvents, toolEvents, collapse, curBrowserMode, cdpSessionState, autoLaunch, dirInfo, privacy] = await Promise.all([
        fetchTelemetrySetting(),
        fetchAgentSettings(),
        fetchChatShowAgentEvents(),
        fetchChatPreserveToolEvents(),
        fetchChatCollapseMessages(),
        fetchBrowserMode(),
        fetchSessionStateCdpEnabled(),
        fetchAutoLaunchSetting(),
        fetchOpenClawStateDir(),
        fetchPrivacyMode(),
      ]);
      setTelemetryEnabled(enabled);
      setDmScope(agentSettings.dmScope);
      setShowAgentEvents(chatEvents);
      setPreserveToolEvents(toolEvents);
      setCollapseMessages(collapse);
      setBrowserMode(curBrowserMode);
      setSessionStateCdpEnabled(cdpSessionState);
      setAutoLaunchEnabled(autoLaunch);
      setDataDirInfo(dirInfo);
      setPrivacyMode(privacy);
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
      trackEvent("settings.dm_scope_changed", { scope: value });
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

  async function handleToggleCollapseMessages(enabled: boolean) {
    const previous = collapseMessages;
    setCollapseMessages(enabled);
    try {
      setSaving(true);
      setError(null);
      await updateChatCollapseMessages(enabled);
      window.dispatchEvent(new CustomEvent("chat-settings-changed"));
    } catch (err) {
      setError(t("settings.chat.failedToSave") + String(err));
      setCollapseMessages(previous);
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

  async function handleToggleAutoLaunch(enabled: boolean) {
    const previous = autoLaunchEnabled;
    setAutoLaunchEnabled(enabled);
    try {
      setSaving(true);
      setError(null);
      await updateAutoLaunchSetting(enabled);
      trackEvent("settings.auto_launch_toggled", { enabled });
    } catch (err) {
      setError(t("settings.autoLaunch.failedToSave") + String(err));
      setAutoLaunchEnabled(previous);
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePrivacyMode(enabled: boolean) {
    const previous = privacyMode;
    setPrivacyMode(enabled);
    try {
      setSaving(true);
      setError(null);
      await updatePrivacyMode(enabled);
      trackEvent("settings.privacy_mode_toggled", { enabled });
      window.dispatchEvent(new CustomEvent("privacy-settings-changed"));
    } catch (err) {
      setError(t("settings.app.title") + ": " + String(err));
      setPrivacyMode(previous);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleSessionStateCdp(enabled: boolean) {
    const previous = sessionStateCdpEnabled;
    setSessionStateCdpEnabled(enabled);
    try {
      setSaving(true);
      setError(null);
      await updateSessionStateCdpEnabled(enabled);
      trackEvent("settings.session_state_cdp_toggled", { enabled });
    } catch (err) {
      setError(t("settings.browser.failedToSave") + String(err));
      setSessionStateCdpEnabled(previous);
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
    const previous = browserMode;
    setBrowserMode(newMode);
    try {
      setSaving(true);
      setError(null);
      await updateBrowserMode(newMode);
      trackEvent("settings.browser_mode_changed", { mode: newMode });
    } catch (err) {
      setError(t("settings.browser.failedToSave") + String(err));
      setBrowserMode(previous);
    } finally {
      setSaving(false);
    }
  }

  async function handleChangeDataDir() {
    const { openFileDialog } = await import("../api/index.js");
    const selected = await openFileDialog();
    if (!selected) return;
    try {
      setSaving(true);
      setError(null);
      await updateOpenClawStateDir(selected);
      setDataDirInfo((prev) => prev ? { ...prev, override: selected } : prev);
      setDataDirRestartNeeded(true);
    } catch (err) {
      setError(t("settings.dataDir.failedToSave") + String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleResetDataDir() {
    try {
      setSaving(true);
      setError(null);
      await resetOpenClawStateDir();
      trackEvent("settings.state_dir_reset");
      setDataDirInfo((prev) => prev ? { ...prev, override: null } : prev);
      setDataDirRestartNeeded(true);
    } catch (err) {
      setError(t("settings.dataDir.failedToReset") + String(err));
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
    <div className="page-enter">

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

        <div>
          <label className="form-label-block">
            {t("settings.browser.mode")}
          </label>
          <Select
            value={browserMode}
            onChange={handleBrowserModeChange}
            options={[
              { value: "standalone", label: t("settings.browser.modeStandalone"), description: t("settings.browser.modeStandaloneDesc") },
              { value: "cdp", label: t("settings.browser.modeCdp"), description: t("settings.browser.modeCdpDesc") },
            ]}
            disabled={saving}
          />
          <div className="form-hint">
            {t("settings.browser.modeHint")}
          </div>
        </div>

        {browserMode === "cdp" && (
          <div className="settings-toggle-card">
            <div className="settings-toggle-label">
              <span>{t("settings.browser.sessionStateCdp")}</span>
              <ToggleSwitch checked={sessionStateCdpEnabled} onChange={handleToggleSessionStateCdp} disabled={saving} />
            </div>
            <div className="form-hint">
              {t("settings.browser.sessionStateCdpHint")}
            </div>
          </div>
        )}
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

        <div className="settings-toggle-card">
          <div className="settings-toggle-label">
            <span>{t("settings.chat.collapseMessages")}</span>
            <ToggleSwitch checked={collapseMessages} onChange={handleToggleCollapseMessages} disabled={saving} />
          </div>
          <div className="form-hint">
            {t("settings.chat.collapseMessagesHint")}
          </div>
        </div>
      </div>

      {/* App Settings Section */}
      <div className="section-card">
        <h3>{t("settings.app.title")}</h3>

        <div className="settings-toggle-card">
          <div className="settings-toggle-label">
            <span>{t("settings.app.privacyMode")}</span>
            <ToggleSwitch checked={privacyMode} onChange={handleTogglePrivacyMode} disabled={saving} />
          </div>
          <div className="form-hint">
            {t("settings.app.privacyModeHint")}
          </div>
        </div>
      </div>

      {/* Auto-Launch Section */}
      <div className="section-card">
        <h3>{t("settings.autoLaunch.title")}</h3>

        <div className="settings-toggle-card">
          <div className="settings-toggle-label">
            <span>{t("settings.autoLaunch.toggle")}</span>
            <ToggleSwitch checked={autoLaunchEnabled} onChange={handleToggleAutoLaunch} disabled={saving} />
          </div>
          {t("settings.autoLaunch.hint") && (
            <div className="form-hint">
              {t("settings.autoLaunch.hint")}
            </div>
          )}
        </div>
      </div>

      {/* Data Directory Section */}
      {dataDirInfo && (
        <div className="section-card">
          <h3>{t("settings.dataDir.title")}</h3>

          <div>
            <div className="settings-toggle-label" style={{ cursor: "default" }}>
              <span>{t("settings.dataDir.label")}</span>
            </div>
            <div className="data-dir-display">
              <code className="data-dir-path">{dataDirInfo.override ?? dataDirInfo.effective}</code>
              {dataDirInfo.override && <span className="badge">{t("settings.dataDir.custom")}</span>}
              {!dataDirInfo.override && <span className="badge badge-muted">{t("settings.dataDir.default")}</span>}
            </div>
            <div className="form-hint">
              {t("settings.dataDir.hint")}
            </div>
          </div>

          <div className="data-dir-actions">
            <button className="btn btn-secondary" onClick={handleChangeDataDir} disabled={saving}>
              {t("settings.dataDir.change")}
            </button>
            {dataDirInfo.override && (
              <button className="btn btn-secondary" onClick={handleResetDataDir} disabled={saving}>
                {t("settings.dataDir.reset")}
              </button>
            )}
          </div>

          {dataDirRestartNeeded && (
            <div className="data-dir-restart-notice">
              {t("settings.dataDir.restartNotice")}
            </div>
          )}
        </div>
      )}

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

        <div className="telemetry-details">
          <h4>{t("settings.telemetry.whatWeCollect")}</h4>
          <ul className="settings-list">
            <li>{t("settings.telemetry.collect.appLifecycle")}</li>
            <li>{t("settings.telemetry.collect.featureUsage")}</li>
            <li>{t("settings.telemetry.collect.errors")}</li>
            <li>{t("settings.telemetry.collect.runtime")}</li>
          </ul>

          <h4>{t("settings.telemetry.whatWeDontCollect")}</h4>
          <ul className="settings-list">
            <li>{t("settings.telemetry.dontCollect.conversations")}</li>
            <li>{t("settings.telemetry.dontCollect.apiKeys")}</li>
            <li>{t("settings.telemetry.dontCollect.ruleText")}</li>
            <li>{t("settings.telemetry.dontCollect.personalInfo")}</li>
          </ul>
        </div>
      </div>

      {/* Diagnostics Section */}
      <div className="section-card">
        <h3>{t("settings.diagnostics.title")}</h3>
        <p className="text-secondary">
          {t("settings.diagnostics.description")}
        </p>

        {doctorOutput.length > 0 && (
          <pre ref={doctorOutputRef} className="doctor-output">
            {doctorOutput.join("\n")}
          </pre>
        )}

        <div className="doctor-actions">
          <button
            className="btn btn-primary"
            onClick={() => runDoctor(false)}
            disabled={doctorStatus === "running"}
          >
            {t("settings.diagnostics.runButton")}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => runDoctor(true)}
            disabled={doctorStatus === "running"}
          >
            {t("settings.diagnostics.fixButton")}
          </button>
          {doctorStatus === "running" && (
            <span className="doctor-status">{t("settings.diagnostics.statusRunning")}</span>
          )}
          {doctorStatus === "done" && (
            <span className="doctor-status doctor-status-success">
              {t("settings.diagnostics.statusDone")}
              {doctorExitCode !== null && ` (${t("settings.diagnostics.statusExitCode", { code: doctorExitCode })})`}
            </span>
          )}
          {doctorStatus === "error" && (
            <span className="doctor-status doctor-status-error">
              {t("settings.diagnostics.statusError")}
              {doctorExitCode !== null && ` (${t("settings.diagnostics.statusExitCode", { code: doctorExitCode })})`}
            </span>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={cdpConfirmOpen}
        onConfirm={() => { setCdpConfirmOpen(false); applyBrowserMode("cdp"); }}
        onCancel={() => setCdpConfirmOpen(false)}
        title={t("settings.browser.cdpConfirmTitle")}
        message={t("settings.browser.cdpConfirm")}
        confirmLabel={t("settings.browser.cdpConfirmOk")}
        cancelLabel={t("common.cancel")}
        confirmVariant="primary"
      />
    </div>
  );
}

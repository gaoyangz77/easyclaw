import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent, fetchAgentSettings, updateAgentSettings, fetchChatShowAgentEvents, updateChatShowAgentEvents, fetchChatPreserveToolEvents, updateChatPreserveToolEvents, fetchChatCollapseMessages, updateChatCollapseMessages, fetchBrowserMode, updateBrowserMode, fetchAutoLaunchSetting, updateAutoLaunchSetting, fetchOpenClawStateDir, updateOpenClawStateDir, resetOpenClawStateDir, fetchPrivacyMode, updatePrivacyMode, fetchSessionStateCdpEnabled, updateSessionStateCdpEnabled, provisionDeps, openFileDialog } from "../api/index.js";
import { DEFAULTS } from "@rivonclaw/core";
import type { OpenClawStateDirInfo } from "../api/index.js";
import { Select } from "../components/inputs/Select.js";
import { ConfirmDialog } from "../components/modals/ConfirmDialog.js";
import { useToast } from "../components/Toast.js";

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
  const [dmScope, setDmScope] = useState("main");
  const [showAgentEvents, setShowAgentEvents] = useState(DEFAULTS.settings.showAgentEvents);
  const [preserveToolEvents, setPreserveToolEvents] = useState(DEFAULTS.settings.preserveToolEvents);
  const [collapseMessages, setCollapseMessages] = useState(DEFAULTS.settings.collapseMessages);
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false);
  const [browserMode, setBrowserMode] = useState<"standalone" | "cdp">(DEFAULTS.settings.browserMode);
  const [sessionStateCdpEnabled, setSessionStateCdpEnabled] = useState(DEFAULTS.settings.sessionStateCdpEnabled);
  const [cdpConfirmOpen, setCdpConfirmOpen] = useState(false);
  const [dataDirInfo, setDataDirInfo] = useState<OpenClawStateDirInfo | null>(null);
  const [dataDirRestartNeeded, setDataDirRestartNeeded] = useState(false);
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem("accentColor") || "blue");
  const [privacyMode, setPrivacyMode] = useState(false);
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { showToast } = useToast();
  const [depsInstalling, setDepsInstalling] = useState(false);
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

  const handleInstallDeps = useCallback(async () => {
    setDepsInstalling(true);
    try {
      await provisionDeps();
    } catch (err) {
      console.error("Failed to trigger deps provisioner:", err);
    } finally {
      setDepsInstalling(false);
    }
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
      const [agentSettings, chatEvents, toolEvents, collapse, curBrowserMode, cdpSessionState, autoLaunch, dirInfo, privacy] = await Promise.all([
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
      setDmScope(agentSettings.dmScope);
      setShowAgentEvents(chatEvents);
      setPreserveToolEvents(toolEvents);
      setCollapseMessages(collapse);
      setBrowserMode(curBrowserMode);
      setSessionStateCdpEnabled(cdpSessionState);
      setAutoLaunchEnabled(autoLaunch);
      setDataDirInfo(dirInfo);
      setPrivacyMode(privacy);
      setLoadError(null);
    } catch (err) {
      setLoadError(t("settings.agent.failedToLoad") + String(err));
    } finally {
      setLoading(false);
    }
  }

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

  async function handleToggleShowAgentEvents(enabled: boolean) {
    const previous = showAgentEvents;
    setShowAgentEvents(enabled);
    try {
      setSaving(true);
      await updateChatShowAgentEvents(enabled);
      window.dispatchEvent(new CustomEvent("chat-settings-changed"));
    } catch (err) {
      showToast(t("settings.chat.failedToSave") + String(err), "error");
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
      await updateChatPreserveToolEvents(enabled);
      window.dispatchEvent(new CustomEvent("chat-settings-changed"));
    } catch (err) {
      showToast(t("settings.chat.failedToSave") + String(err), "error");
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
      await updateChatCollapseMessages(enabled);
      window.dispatchEvent(new CustomEvent("chat-settings-changed"));
    } catch (err) {
      showToast(t("settings.chat.failedToSave") + String(err), "error");
      setCollapseMessages(previous);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleAutoLaunch(enabled: boolean) {
    const previous = autoLaunchEnabled;
    setAutoLaunchEnabled(enabled);
    try {
      setSaving(true);
      await updateAutoLaunchSetting(enabled);
      trackEvent("settings.auto_launch_toggled", { enabled });
    } catch (err) {
      showToast(t("settings.autoLaunch.failedToSave") + String(err), "error");
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
      await updatePrivacyMode(enabled);
      trackEvent("settings.privacy_mode_toggled", { enabled });
      window.dispatchEvent(new CustomEvent("privacy-settings-changed"));
    } catch (err) {
      showToast(t("settings.app.title") + ": " + String(err), "error");
      setPrivacyMode(previous);
    } finally {
      setSaving(false);
    }
  }

  function handleAccentColorChange(color: string) {
    setAccentColor(color);
    localStorage.setItem("accentColor", color);
    window.dispatchEvent(new CustomEvent("accent-color-changed"));
    trackEvent("settings.accent_color_changed", { color });
  }

  function handleToggleTutorial(enabled: boolean) {
    localStorage.setItem("tutorial.enabled", String(enabled));
    setTutorialEnabled(enabled);
    window.dispatchEvent(new CustomEvent("tutorial-settings-changed"));
  }

  function handleToggleShowAgentName(enabled: boolean) {
    localStorage.setItem("showAgentName", String(enabled));
    setShowAgentName(enabled);
    window.dispatchEvent(new CustomEvent("brand-display-changed"));
  }

  async function handleToggleSessionStateCdp(enabled: boolean) {
    const previous = sessionStateCdpEnabled;
    setSessionStateCdpEnabled(enabled);
    try {
      setSaving(true);
      await updateSessionStateCdpEnabled(enabled);
      trackEvent("settings.session_state_cdp_toggled", { enabled });
    } catch (err) {
      showToast(t("settings.browser.failedToSave") + String(err), "error");
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
      await updateBrowserMode(newMode);
      trackEvent("settings.browser_mode_changed", { mode: newMode });
    } catch (err) {
      showToast(t("settings.browser.failedToSave") + String(err), "error");
      setBrowserMode(previous);
    } finally {
      setSaving(false);
    }
  }

  async function handleChangeDataDir() {
    const selected = await openFileDialog();
    if (!selected) return;
    try {
      setSaving(true);
      await updateOpenClawStateDir(selected);
      setDataDirInfo((prev) => prev ? { ...prev, override: selected } : prev);
      setDataDirRestartNeeded(true);
    } catch (err) {
      showToast(t("settings.dataDir.failedToSave") + String(err), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetDataDir() {
    try {
      setSaving(true);
      await resetOpenClawStateDir();
      trackEvent("settings.state_dir_reset");
      setDataDirInfo((prev) => prev ? { ...prev, override: null } : prev);
      setDataDirRestartNeeded(true);
    } catch (err) {
      showToast(t("settings.dataDir.failedToReset") + String(err), "error");
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

      {loadError && (
        <div className="error-alert">
          {loadError}
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

        <div>
          <label className="form-label-block">
            {t("settings.app.accentColor")}
          </label>
          <div className="accent-color-picker">
            <button
              className={`accent-color-swatch accent-color-swatch-blue${accentColor === "blue" ? " accent-color-swatch-active" : ""}`}
              onClick={() => handleAccentColorChange("blue")}
              title={t("settings.app.accentBlue")}
            />
            <button
              className={`accent-color-swatch accent-color-swatch-orange${accentColor === "orange" ? " accent-color-swatch-active" : ""}`}
              onClick={() => handleAccentColorChange("orange")}
              title={t("settings.app.accentOrange")}
            />
            <button
              className={`accent-color-swatch accent-color-swatch-emerald${accentColor === "emerald" ? " accent-color-swatch-active" : ""}`}
              onClick={() => handleAccentColorChange("emerald")}
              title={t("settings.app.accentEmerald")}
            />
            <button
              className={`accent-color-swatch accent-color-swatch-rose${accentColor === "rose" ? " accent-color-swatch-active" : ""}`}
              onClick={() => handleAccentColorChange("rose")}
              title={t("settings.app.accentRose")}
            />
            <button
              className={`accent-color-swatch accent-color-swatch-violet${accentColor === "violet" ? " accent-color-swatch-active" : ""}`}
              onClick={() => handleAccentColorChange("violet")}
              title={t("settings.app.accentViolet")}
            />
            <button
              className={`accent-color-swatch accent-color-swatch-gold${accentColor === "gold" ? " accent-color-swatch-active" : ""}`}
              onClick={() => handleAccentColorChange("gold")}
              title={t("settings.app.accentGold")}
            />
            <button
              className={`accent-color-swatch accent-color-swatch-crimson${accentColor === "crimson" ? " accent-color-swatch-active" : ""}`}
              onClick={() => handleAccentColorChange("crimson")}
              title={t("settings.app.accentCrimson")}
            />
            <button
              className={`accent-color-swatch accent-color-swatch-tiffany${accentColor === "tiffany" ? " accent-color-swatch-active" : ""}`}
              onClick={() => handleAccentColorChange("tiffany")}
              title={t("settings.app.accentTiffany")}
            />
            <button
              className={`accent-color-swatch accent-color-swatch-gray${accentColor === "gray" ? " accent-color-swatch-active" : ""}`}
              onClick={() => handleAccentColorChange("gray")}
              title={t("settings.app.accentGray")}
            />
          </div>
        </div>

        <div className="settings-toggle-card">
          <div className="settings-toggle-label">
            <span>{t("settings.app.privacyMode")}</span>
            <ToggleSwitch checked={privacyMode} onChange={handleTogglePrivacyMode} disabled={saving} />
          </div>
          <div className="form-hint">
            {t("settings.app.privacyModeHint")}
          </div>
        </div>

        <div className="settings-toggle-card">
          <div className="settings-toggle-label">
            <span>{t("settings.app.showAgentName")}</span>
            <ToggleSwitch checked={showAgentName} onChange={handleToggleShowAgentName} />
          </div>
          <div className="form-hint">
            {t("settings.app.showAgentNameHint")}
          </div>
        </div>
      </div>

      {/* Tutorial Section */}
      <div className="section-card">
        <h3>{t("tutorial.settings.toggle")}</h3>

        <div className="settings-toggle-card">
          <div className="settings-toggle-label">
            <span>{t("tutorial.settings.toggle")}</span>
            <ToggleSwitch checked={tutorialEnabled} onChange={handleToggleTutorial} />
          </div>
          <div className="form-hint">
            {t("tutorial.settings.hint")}
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
            <div className="settings-toggle-label settings-toggle-label-static">
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

      {/* System Dependencies Section */}
      <div className="section-card">
        <h3>{t("settings.deps.title")}</h3>
        <p className="text-secondary">
          {t("settings.deps.description")}
        </p>
        <div className="doctor-actions">
          <button
            className="btn btn-primary"
            onClick={handleInstallDeps}
            disabled={depsInstalling}
          >
            {t("settings.deps.installButton")}
          </button>
          {depsInstalling && (
            <span className="doctor-status">{t("settings.deps.statusRunning")}</span>
          )}
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

import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../../components/modals/ConfirmDialog.js";
import { observer } from "mobx-react-lite";
import { useAgentSettings } from "./hooks/useAgentSettings.js";
import { useAppSettingsToggles } from "./hooks/useAppSettingsToggles.js";
import { useAppearanceSettings } from "./hooks/useAppearanceSettings.js";
import { useOpenClawStateDir } from "./hooks/useOpenClawStateDir.js";
import { useDoctorRunner } from "./hooks/useDoctorRunner.js";
import { AgentSettingsSection } from "./components/AgentSettingsSection.js";
import { ChatSettingsSection } from "./components/ChatSettingsSection.js";
import { AppSettingsSection } from "./components/AppSettingsSection.js";
import { TutorialSection } from "./components/TutorialSection.js";
import { AutoLaunchSection } from "./components/AutoLaunchSection.js";
import { StateDirectorySection } from "./components/StateDirectorySection.js";
import { TelemetrySection } from "./components/TelemetrySection.js";
import { DependenciesSection } from "./components/DependenciesSection.js";
import { DiagnosticsSection } from "./components/DiagnosticsSection.js";

export const SettingsPage = observer(function SettingsPage() {
  const { t } = useTranslation();
  const agentSettings = useAgentSettings();
  const toggles = useAppSettingsToggles();
  const appearance = useAppearanceSettings();
  const stateDir = useOpenClawStateDir();
  const doctor = useDoctorRunner();

  if (agentSettings.loading) {
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

      <AgentSettingsSection
        dmScope={agentSettings.dmScope}
        saving={agentSettings.saving || toggles.saving}
        settingsReady={toggles.settingsReady}
        browserMode={toggles.browserMode}
        sessionStateCdpEnabled={toggles.sessionStateCdpEnabled}
        handleDmScopeChange={agentSettings.handleDmScopeChange}
        handleBrowserModeChange={toggles.handleBrowserModeChange}
        handleToggleSessionStateCdp={toggles.handleToggleSessionStateCdp}
      />

      <ChatSettingsSection
        showAgentEvents={toggles.showAgentEvents}
        preserveToolEvents={toggles.preserveToolEvents}
        collapseMessages={toggles.collapseMessages}
        saving={toggles.saving}
        settingsReady={toggles.settingsReady}
        handleToggleShowAgentEvents={toggles.handleToggleShowAgentEvents}
        handleTogglePreserveToolEvents={toggles.handleTogglePreserveToolEvents}
        handleToggleCollapseMessages={toggles.handleToggleCollapseMessages}
      />

      <AppSettingsSection
        accentColor={appearance.accentColor}
        privacyMode={toggles.privacyMode}
        showAgentName={appearance.showAgentName}
        saving={toggles.saving}
        settingsReady={toggles.settingsReady}
        handleAccentColorChange={appearance.handleAccentColorChange}
        handleTogglePrivacyMode={toggles.handleTogglePrivacyMode}
        handleToggleShowAgentName={appearance.handleToggleShowAgentName}
      />

      <TutorialSection
        tutorialEnabled={appearance.tutorialEnabled}
        handleToggleTutorial={appearance.handleToggleTutorial}
      />

      <AutoLaunchSection
        autoLaunchEnabled={toggles.autoLaunchEnabled}
        saving={toggles.saving}
        settingsReady={toggles.settingsReady}
        handleToggleAutoLaunch={toggles.handleToggleAutoLaunch}
      />

      {stateDir.dataDirInfo && (
        <StateDirectorySection
          dataDirInfo={stateDir.dataDirInfo}
          dataDirRestartNeeded={stateDir.dataDirRestartNeeded}
          saving={stateDir.saving}
          handleChangeDataDir={stateDir.handleChangeDataDir}
          handleResetDataDir={stateDir.handleResetDataDir}
        />
      )}

      <TelemetrySection
        telemetryEnabled={toggles.telemetryEnabled}
        saving={toggles.saving}
        settingsReady={toggles.settingsReady}
        handleToggleTelemetry={toggles.handleToggleTelemetry}
      />

      <DependenciesSection
        depsInstalling={doctor.depsInstalling}
        handleInstallDeps={doctor.handleInstallDeps}
      />

      <DiagnosticsSection
        doctorStatus={doctor.doctorStatus}
        doctorOutput={doctor.doctorOutput}
        doctorExitCode={doctor.doctorExitCode}
        doctorOutputRef={doctor.doctorOutputRef}
        runDoctor={doctor.runDoctor}
      />

      <ConfirmDialog
        isOpen={toggles.cdpConfirmOpen}
        onConfirm={() => { toggles.setCdpConfirmOpen(false); toggles.applyBrowserMode("cdp"); }}
        onCancel={() => toggles.setCdpConfirmOpen(false)}
        title={t("settings.browser.cdpConfirmTitle")}
        message={t("settings.browser.cdpConfirm")}
        confirmLabel={t("settings.browser.cdpConfirmOk")}
        cancelLabel={t("common.cancel")}
        confirmVariant="primary"
      />
    </div>
  );
});

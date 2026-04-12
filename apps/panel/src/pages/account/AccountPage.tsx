import { useState } from "react";
import { useTranslation } from "react-i18next";
import { observer } from "mobx-react-lite";
import { getUserInitial } from "../../lib/user-manager.js";
import { ConfirmDialog } from "../../components/modals/ConfirmDialog.js";
import { useEntityStore } from "../../store/EntityStoreProvider.js";
import { useToolDisplayLabel } from "../../lib/tool-display.js";
import { useSurfaceForm } from "./hooks/useSurfaceForm.js";
import { useRunProfileForm } from "./hooks/useRunProfileForm.js";
import { useDefaultRunProfile } from "./hooks/useDefaultRunProfile.js";
import { AccountProfileCard } from "./components/AccountProfileCard.js";
import { SurfacesSection } from "./components/SurfacesSection.js";
import { SurfaceFormModal } from "./components/SurfaceFormModal.js";
import { SurfacePresetModal } from "./components/SurfacePresetModal.js";
import { RunProfilesSection } from "./components/RunProfilesSection.js";
import { RunProfileFormModal } from "./components/RunProfileFormModal.js";
import { RunProfilePresetModal } from "./components/RunProfilePresetModal.js";
import { ModulesSection } from "./components/ModulesSection.js";
import { writeSkillTemplate } from "../../api/skills.js";

/** Resolve a display name for system-provided surfaces/profiles via i18n. */
function useSystemName() {
  const { t } = useTranslation();
  return (name: string, isSystem: boolean) =>
    isSystem ? (t(`surfaces.systemNames.${name}`, { defaultValue: name }) as string) : name;
}

export const AccountPage = observer(function AccountPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useTranslation();
  const resolveSystemName = useSystemName();
  const entityStore = useEntityStore();
  const user = entityStore.currentUser;

  const toolDisplayLabel = useToolDisplayLabel();

  const subscription = entityStore.subscriptionStatus;
  const llmQuota = entityStore.llmQuotaStatus;

  // Read surfaces and run-profiles from MST store (auto-synced via SSE)
  const surfaces = entityStore.allSurfaces;
  const profiles = entityStore.allRunProfiles;

  // ── Module toggle state ──
  const [moduleToggling, setModuleToggling] = useState(false);

  // ── Refresh tools state ──
  const [refreshingTools, setRefreshingTools] = useState(false);

  // ── Confirm dialog state ──
  const [confirmDeleteSurfaceId, setConfirmDeleteSurfaceId] = useState<string | null>(null);
  const [confirmDeleteProfileId, setConfirmDeleteProfileId] = useState<string | null>(null);

  // ── Hooks ──
  const { savingDefault, defaultProfileError, handleDefaultProfileChange } = useDefaultRunProfile();

  const surfaceForm = useSurfaceForm();

  const profileForm = useRunProfileForm({
    onDefaultProfileCleared: () => handleDefaultProfileChange(""),
  });

  // ── Refresh tools handler ──
  async function handleRefreshTools() {
    setRefreshingTools(true);
    try {
      await entityStore.refreshToolSpecs();
    } finally {
      setRefreshingTools(false);
    }
  }

  function handleLogout() {
    entityStore.logout();
    onNavigate("/");
  }

  async function handleModuleToggle() {
    setModuleToggling(true);
    try {
      if (entityStore.isModuleEnrolled("GLOBAL_ECOMMERCE_SELLER")) {
        await entityStore.currentUser!.unenrollModule("GLOBAL_ECOMMERCE_SELLER");
      } else {
        await entityStore.currentUser!.enrollModule("GLOBAL_ECOMMERCE_SELLER");
        // Download all CS preset skills on module enrollment (fire-and-forget, always overwrite)
        entityStore.fetchCsPresetSkills()
          .then(async (skills: Record<string, string> | null) => {
            if (!skills) return;
            for (const [key, content] of Object.entries(skills)) {
              await writeSkillTemplate(key, content);
            }
          })
          .catch(() => {});
      }
    } catch {
      // Error will surface via network layer
    } finally {
      setModuleToggling(false);
    }
  }

  if (!user) {
    return (
      <div className="account-page page-enter">
        <div className="section-card">
          <h2>{t("auth.loginRequired")}</h2>
          <p>{t("auth.loginFromSidebar")}</p>
        </div>
      </div>
    );
  }

  const initial = getUserInitial(user);

  const surfaceNameById: Record<string, string> = {};
  for (const s of surfaces) {
    surfaceNameById[s.id] = resolveSystemName(s.name, !s.userId);
  }

  return (
    <div className="account-page page-enter">

      {/* ── Profile & Subscription ── */}
      <AccountProfileCard
        user={user}
        initial={initial}
        subscription={subscription}
        llmQuota={llmQuota}
        onLogout={handleLogout}
      />

      {/* ── Surfaces ── */}
      <SurfacesSection
        surfaces={surfaces}
        profiles={profiles}
        surfaceError={surfaceForm.surfaceError}
        resolveSystemName={resolveSystemName}
        toolDisplayLabel={toolDisplayLabel}
        refreshingTools={refreshingTools}
        onRefreshTools={handleRefreshTools}
        onCreateSurface={surfaceForm.openCreateSurface}
        onEditSurface={surfaceForm.openEditSurface}
        onDeleteSurface={(id) => setConfirmDeleteSurfaceId(id)}
        onOpenPreset={surfaceForm.openPresetModal}
      />

      {/* ── Run Profiles ── */}
      <RunProfilesSection
        profiles={profiles}
        surfaces={surfaces}
        profileError={profileForm.profileError}
        defaultRunProfileId={user?.defaultRunProfileId}
        resolveSystemName={resolveSystemName}
        toolDisplayLabel={toolDisplayLabel}
        surfaceNameById={surfaceNameById}
        savingDefault={savingDefault}
        defaultProfileError={defaultProfileError}
        onDefaultProfileChange={handleDefaultProfileChange}
        onCreateProfile={profileForm.openCreateProfile}
        onOpenPreset={profileForm.openPresetModal}
        onEditProfile={profileForm.openEditProfile}
        onDeleteProfile={(id) => setConfirmDeleteProfileId(id)}
      />

      {/* ── Modules ── */}
      <ModulesSection
        isEnrolled={entityStore.isModuleEnrolled("GLOBAL_ECOMMERCE_SELLER")}
        moduleToggling={moduleToggling}
        onToggle={handleModuleToggle}
      />

      {/* ── Surface Modal ── */}
      <SurfaceFormModal
        isOpen={surfaceForm.surfaceModalOpen}
        editingSurface={surfaceForm.editingSurface}
        surfaceName={surfaceForm.surfaceName}
        surfaceDescription={surfaceForm.surfaceDescription}
        surfaceToolIds={surfaceForm.surfaceToolIds}
        savingSurface={surfaceForm.savingSurface}
        profiles={profiles}
        onNameChange={surfaceForm.setSurfaceName}
        onDescriptionChange={surfaceForm.setSurfaceDescription}
        onToolIdsChange={surfaceForm.setSurfaceToolIds}
        onSave={surfaceForm.handleSaveSurface}
        onClose={surfaceForm.closeSurfaceModal}
      />

      {/* ── Preset Modal ── */}
      <SurfacePresetModal
        isOpen={surfaceForm.presetModalOpen}
        surfaces={surfaces}
        selectedPresetId={surfaceForm.selectedPresetId}
        savingSurface={surfaceForm.savingSurface}
        resolveSystemName={resolveSystemName}
        onSelectedPresetIdChange={surfaceForm.setSelectedPresetId}
        onCreateFromPreset={surfaceForm.handleCreateFromPreset}
        onClose={surfaceForm.closePresetModal}
      />

      {/* ── Delete Surface Confirm ── */}
      <ConfirmDialog
        isOpen={confirmDeleteSurfaceId !== null}
        title={t("surfaces.deleteSurface")}
        message={t("surfaces.confirmDeleteSurface")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => { if (confirmDeleteSurfaceId) { setConfirmDeleteSurfaceId(null); surfaceForm.handleDeleteSurface(confirmDeleteSurfaceId); } }}
        onCancel={() => setConfirmDeleteSurfaceId(null)}
      />

      {/* ── Delete RunProfile Confirm ── */}
      <ConfirmDialog
        isOpen={confirmDeleteProfileId !== null}
        title={t("surfaces.deleteRunProfile")}
        message={t("surfaces.confirmDeleteRunProfile")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => { if (confirmDeleteProfileId) { setConfirmDeleteProfileId(null); profileForm.handleDeleteProfile(confirmDeleteProfileId); } }}
        onCancel={() => setConfirmDeleteProfileId(null)}
      />

      {/* ── RunProfile Preset Modal ── */}
      <RunProfilePresetModal
        isOpen={profileForm.presetModalOpen}
        profiles={profiles}
        selectedPresetId={profileForm.selectedPresetId}
        savingProfile={profileForm.savingProfile}
        resolveSystemName={resolveSystemName}
        surfaceNameById={surfaceNameById}
        onSelectedPresetIdChange={profileForm.setSelectedPresetId}
        onCreateFromPreset={() => profileForm.handleCreateFromPreset(profiles)}
        onClose={profileForm.closePresetModal}
      />

      {/* ── RunProfile Modal ── */}
      <RunProfileFormModal
        isOpen={profileForm.profileModalOpen}
        editingProfile={profileForm.editingProfile}
        profileName={profileForm.profileName}
        profileToolIds={profileForm.profileToolIds}
        profileSurfaceId={profileForm.profileSurfaceId}
        savingProfile={profileForm.savingProfile}
        surfaces={surfaces}
        resolveSystemName={resolveSystemName}
        onNameChange={profileForm.setProfileName}
        onToolIdsChange={profileForm.setProfileToolIds}
        onSurfaceIdChange={profileForm.setProfileSurfaceId}
        onSave={profileForm.handleSaveProfile}
        onClose={profileForm.closeProfileModal}
      />
    </div>
  );
});

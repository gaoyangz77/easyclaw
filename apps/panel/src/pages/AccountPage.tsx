import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getUserInitial } from "../lib/user-manager.js";
import { Modal } from "../components/modals/Modal.js";
import { ToolMultiSelect } from "../components/inputs/ToolMultiSelect.js";
import { Select } from "../components/inputs/Select.js";
import { ModuleIcon } from "../components/icons.js";
import { useAuth, usePanelStore, useToolRegistry } from "../stores/index.js";
import type { Surface } from "../api/surfaces.js";
import type { RunProfile } from "../api/run-profiles.js";

export function AccountPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  const { tools: allTools } = useToolRegistry();
  const enrolledModules = usePanelStore((s) => s.enrolledModules);
  const enrollModule = usePanelStore((s) => s.enrollModule);
  const unenrollModule = usePanelStore((s) => s.unenrollModule);
  const subscription = usePanelStore((s) => s.subscriptionStatus);
  const llmQuota = usePanelStore((s) => s.llmQuota);
  const surfaces = usePanelStore((s) => s.surfaces);
  const profiles = usePanelStore((s) => s.runProfiles);
  const storeFetchRunProfiles = usePanelStore((s) => s.fetchRunProfiles);
  const storeCreateSurface = usePanelStore((s) => s.createSurface);
  const storeUpdateSurface = usePanelStore((s) => s.updateSurface);
  const storeDeleteSurface = usePanelStore((s) => s.deleteSurface);
  const storeCreateRunProfile = usePanelStore((s) => s.createRunProfile);
  const storeUpdateRunProfile = usePanelStore((s) => s.updateRunProfile);
  const storeDeleteRunProfile = usePanelStore((s) => s.deleteRunProfile);

  // ── Module toggle state ──
  const [moduleToggling, setModuleToggling] = useState(false);

  // ── Surface modal state ──
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [surfaceModalOpen, setSurfaceModalOpen] = useState(false);
  const [editingSurface, setEditingSurface] = useState<Surface | null>(null);
  const [surfaceName, setSurfaceName] = useState("");
  const [surfaceDescription, setSurfaceDescription] = useState("");
  const [surfaceToolIds, setSurfaceToolIds] = useState<Set<string>>(new Set());
  const [savingSurface, setSavingSurface] = useState(false);
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState("");

  // ── Run Profile modal state ──
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<RunProfile | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileToolIds, setProfileToolIds] = useState<Set<string>>(new Set());
  const [profileSurfaceId, setProfileSurfaceId] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // ── Surface handlers ──
  function openCreateSurface() {
    setEditingSurface(null);
    setSurfaceName("");
    setSurfaceDescription("");
    setSurfaceToolIds(new Set());
    setSurfaceModalOpen(true);
  }

  function openEditSurface(s: Surface) {
    setEditingSurface(s);
    setSurfaceName(s.name);
    setSurfaceDescription(s.description || "");
    setSurfaceToolIds(new Set(s.allowedToolIds));
    setSurfaceModalOpen(true);
  }

  function closeSurfaceModal() {
    setSurfaceModalOpen(false);
    setEditingSurface(null);
  }

  async function handleSaveSurface() {
    if (!surfaceName.trim()) return;
    setSavingSurface(true);
    setSurfaceError(null);
    try {
      if (editingSurface) {
        await storeUpdateSurface(editingSurface.id, {
          name: surfaceName.trim(),
          description: surfaceDescription.trim() || undefined,
          allowedToolIds: Array.from(surfaceToolIds),
          allowedCategories: [],
        });
      } else {
        await storeCreateSurface({
          name: surfaceName.trim(),
          description: surfaceDescription.trim() || undefined,
          allowedToolIds: Array.from(surfaceToolIds),
          allowedCategories: [],
        });
      }
      closeSurfaceModal();
    } catch {
      setSurfaceError(t("surfaces.failedToSave"));
    } finally {
      setSavingSurface(false);
    }
  }

  function handleCreateFromPreset() {
    const source = surfaces.find((s) => s.id === selectedPresetId);
    if (!source) return;
    setPresetModalOpen(false);
    setSelectedPresetId("");
    setEditingSurface(null);
    setSurfaceName(`${source.name} ${t("surfaces.copySuffix")}`);
    setSurfaceDescription(source.description || "");
    // System Default Surface → pre-select all available tools
    const isSystemDefault = source.userId === null && source.allowedToolIds.length === 0;
    const prefilledIds = isSystemDefault
      ? new Set(allTools.map((t) => t.id))
      : new Set(source.allowedToolIds);
    setSurfaceToolIds(prefilledIds);
    setSurfaceModalOpen(true);
  }

  async function handleDeleteSurface(id: string) {
    if (!window.confirm(t("surfaces.confirmDeleteSurface"))) return;
    setSurfaceError(null);
    try {
      await storeDeleteSurface(id);
      await storeFetchRunProfiles();
    } catch {
      setSurfaceError(t("surfaces.failedToDelete"));
    }
  }

  // ── Run Profile handlers ──
  function openCreateProfile() {
    setEditingProfile(null);
    setProfileName("");
    setProfileToolIds(new Set());
    setProfileSurfaceId(surfaces[0]?.id ?? "");
    setProfileModalOpen(true);
  }

  function openEditProfile(p: RunProfile) {
    setEditingProfile(p);
    setProfileName(p.name);
    setProfileToolIds(new Set(p.selectedToolIds));
    setProfileSurfaceId(p.surfaceId);
    setProfileModalOpen(true);
  }

  function closeProfileModal() {
    setProfileModalOpen(false);
    setEditingProfile(null);
  }

  async function handleSaveProfile() {
    if (!profileName.trim() || !profileSurfaceId) return;
    setSavingProfile(true);
    setProfileError(null);
    try {
      if (editingProfile) {
        await storeUpdateRunProfile(editingProfile.id, {
          name: profileName.trim(),
          selectedToolIds: Array.from(profileToolIds),
        });
      } else {
        await storeCreateRunProfile({
          name: profileName.trim(),
          selectedToolIds: Array.from(profileToolIds),
          surfaceId: profileSurfaceId,
        });
      }
      closeProfileModal();
    } catch {
      setProfileError(t("surfaces.failedToSaveProfile"));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleDeleteProfile(profileId: string) {
    if (!window.confirm(t("surfaces.confirmDeleteRunProfile"))) return;
    setProfileError(null);
    try {
      await storeDeleteRunProfile(profileId);
    } catch {
      setProfileError(t("surfaces.failedToDeleteProfile"));
    }
  }

  function handleLogout() {
    logout();
    onNavigate("/");
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
    surfaceNameById[s.id] = s.name;
  }

  return (
    <div className="account-page page-enter">

      {/* ── Profile & Subscription ── */}
      <div className="section-card account-profile-card">
        <div className="account-profile-header">
          <div className="account-profile-identity">
            <div className="account-avatar">{initial}</div>
            <div className="account-profile-name-group">
              {user.name && <span className="account-profile-name">{user.name}</span>}
              <span className="account-profile-email">{user.email}</span>
            </div>
          </div>
          <button className="btn btn-danger btn-sm" onClick={handleLogout}>
            {t("auth.logout")}
          </button>
        </div>

        <div className="account-info-grid">
          <div className="account-info-item">
            <span className="account-info-label">{t("account.plan")}</span>
            <span className="account-info-value">
              <span className="acct-badge acct-badge-plan">{t(`subscription.${(subscription?.plan ?? user.plan).toLowerCase()}`)}</span>
            </span>
          </div>
          <div className="account-info-item">
            <span className="account-info-label">{t("account.memberSince")}</span>
            <span className="account-info-value">
              {new Date(user.createdAt).toLocaleDateString()}
            </span>
          </div>
          <div className="account-info-item">
            <span className="account-info-label">{t("account.validUntil")}</span>
            <span className="account-info-value">
              {subscription ? new Date(subscription.validUntil).toLocaleDateString() : "—"}
            </span>
          </div>
          {llmQuota && (
            <>
              <div className="account-info-item account-info-item-wide quota-five-hour">
                <div className="quota-header">
                  <span className="account-info-label">{t("account.quotaFiveHour")}</span>
                  <span className="quota-refresh-time">
                    {t("account.quotaRefreshAt", { time: new Date(llmQuota.fiveHour.refreshAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}
                  </span>
                </div>
                <div className="quota-bar-wrap">
                  <progress
                    className={`quota-bar${llmQuota.fiveHour.remainingPercent < 20 ? " quota-bar-low" : ""}`}
                    value={llmQuota.fiveHour.remainingPercent}
                    max={100}
                  />
                  <span className="quota-bar-label">{Math.round(llmQuota.fiveHour.remainingPercent)}%</span>
                </div>
              </div>
              <div className="account-info-item account-info-item-wide quota-weekly">
                <div className="quota-header">
                  <span className="account-info-label">{t("account.quotaWeekly")}</span>
                  <span className="quota-refresh-time">
                    {t("account.quotaRefreshAt", { time: new Date(llmQuota.weekly.refreshAt).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) })}
                  </span>
                </div>
                <div className="quota-bar-wrap">
                  <progress
                    className={`quota-bar${llmQuota.weekly.remainingPercent < 20 ? " quota-bar-low" : ""}`}
                    value={llmQuota.weekly.remainingPercent}
                    max={100}
                  />
                  <span className="quota-bar-label">{Math.round(llmQuota.weekly.remainingPercent)}%</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Surfaces ── */}
      <div className="section-card">
        <div className="acct-section-header">
          <div>
            <h3>{t("surfaces.surfacesTitle")}</h3>
            <p className="acct-section-desc">{t("surfaces.description")}</p>
          </div>
          <div className="td-actions">
            <button className="btn btn-primary btn-sm" onClick={openCreateSurface}>
              {t("surfaces.createSurface")}
            </button>
            {surfaces.length > 0 && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { setSelectedPresetId(""); setPresetModalOpen(true); }}
              >
                {t("surfaces.createFromPreset")}
              </button>
            )}
          </div>
        </div>

        {surfaceError && <div className="error-alert">{surfaceError}</div>}

        {surfaces.length === 0 ? (
          <div className="empty-cell">{t("surfaces.noSurfaces")}</div>
        ) : (
          <div className="acct-item-list">
            {surfaces.map((s) => {
              const isSystem = s.userId === null;
              const profileCount = profiles.filter((p) => p.surfaceId === s.id).length;
              return (
                <div key={s.id} className={`acct-item${isSystem ? " acct-item-system" : ""}`}>
                  <div className="acct-item-title-row">
                    <span className="acct-item-name">{s.name}</span>
                    {isSystem && <span className="acct-badge-system">{t("surfaces.system")}</span>}
                    {s.allowedToolIds.length === 0 && (
                      <span className="acct-badge-subtle">{t("surfaces.unrestricted")}</span>
                    )}
                    {!isSystem && (
                      <div className="acct-item-actions">
                        <button className="btn btn-secondary btn-sm" onClick={() => openEditSurface(s)}>
                          {t("surfaces.editSurface")}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteSurface(s.id)}>
                          {t("surfaces.deleteSurface")}
                        </button>
                      </div>
                    )}
                  </div>
                  {s.description && <span className="acct-item-desc">{s.description}</span>}
                  <div className="acct-item-meta">
                    {profileCount > 0 && (
                      <span>{profileCount} {t("surfaces.runProfilesTitle").toLowerCase()}</span>
                    )}
                    {s.allowedToolIds.length > 0 && (
                      <span>{t("surfaces.toolCount", { count: s.allowedToolIds.length })}</span>
                    )}
                  </div>
                  {s.allowedToolIds.length > 0 && (
                    <div className="acct-tool-chips">
                      {s.allowedToolIds.map((toolId) => (
                        <span key={toolId} className="acct-tool-chip">
                          {t(`tools.selector.name.${toolId}`, { defaultValue: toolId })}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Run Profiles ── */}
      <div className="section-card">
        <div className="acct-section-header">
          <div>
            <h3>{t("surfaces.runProfilesTitle")}</h3>
            <p className="acct-section-desc">{t("account.runProfilesDesc")}</p>
          </div>
          <div className="td-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={openCreateProfile}
              disabled={surfaces.length === 0}
            >
              {t("surfaces.createRunProfile")}
            </button>
          </div>
        </div>

        {profileError && <div className="error-alert">{profileError}</div>}

        {profiles.length === 0 ? (
          <div className="empty-cell">{t("surfaces.noRunProfiles")}</div>
        ) : (
          <div className="acct-item-list">
            {profiles.map((p) => {
              const isSystem = p.userId === null;
              const surfName = surfaceNameById[p.surfaceId] || p.surfaceId;
              return (
                <div key={p.id} className={`acct-item${isSystem ? " acct-item-system" : ""}`}>
                  <div className="acct-item-title-row">
                    <span className="acct-item-name">{p.name}</span>
                    {isSystem && <span className="acct-badge-system">{t("surfaces.system")}</span>}
                    {!isSystem && (
                      <div className="acct-item-actions">
                        <button className="btn btn-secondary btn-sm" onClick={() => openEditProfile(p)}>
                          {t("surfaces.editRunProfile")}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteProfile(p.id)}>
                          {t("surfaces.deleteRunProfile")}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="acct-item-meta">
                    <span>{surfName}</span>
                    <span>{t("surfaces.toolCount", { count: p.selectedToolIds.length })}</span>
                  </div>
                  {p.selectedToolIds.length > 0 && (() => {
                    const parentSurface = surfaces.find((s) => s.id === p.surfaceId);
                    const restricted = parentSurface && parentSurface.allowedToolIds.length > 0;
                    const allowedSet = restricted ? new Set(parentSurface.allowedToolIds) : null;
                    return (
                      <div className="acct-tool-chips">
                        {p.selectedToolIds.map((toolId) => {
                          const outOfScope = allowedSet && !allowedSet.has(toolId);
                          return (
                            <span
                              key={toolId}
                              className={`acct-tool-chip${outOfScope ? " acct-tool-chip-warn" : ""}`}
                              title={outOfScope ? t("surfaces.toolOutOfScope") : undefined}
                            >
                              {t(`tools.selector.name.${toolId}`, { defaultValue: toolId })}
                              {outOfScope && <span className="acct-tool-chip-icon">⚠</span>}
                            </span>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modules ── */}
      <div className="section-card">
        <div className="acct-section-header">
          <div>
            <h3>{t("modules.title")}</h3>
            <p className="acct-section-desc">{t("modules.description")}</p>
          </div>
        </div>

        <div className="acct-item-list">
          <div className="module-card">
            <div className="module-card-icon">
              <ModuleIcon size={22} />
            </div>
            <div className="module-card-body">
              <span className="module-card-name">{t("modules.globalEcommerceSeller.name")}</span>
              <span className="module-card-desc">{t("modules.globalEcommerceSeller.description")}</span>
            </div>
            <div className="module-card-toggle">
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={enrolledModules.has("GLOBAL_ECOMMERCE_SELLER")}
                  disabled={moduleToggling}
                  onChange={async () => {
                    setModuleToggling(true);
                    try {
                      if (enrolledModules.has("GLOBAL_ECOMMERCE_SELLER")) {
                        await unenrollModule("GLOBAL_ECOMMERCE_SELLER");
                      } else {
                        await enrollModule("GLOBAL_ECOMMERCE_SELLER");
                      }
                    } catch {
                      // Error will surface via network layer
                    } finally {
                      setModuleToggling(false);
                    }
                  }}
                />
                <span
                  className={`toggle-track ${enrolledModules.has("GLOBAL_ECOMMERCE_SELLER") ? "toggle-track-on" : "toggle-track-off"} ${moduleToggling ? "toggle-track-disabled" : ""}`}
                >
                  <span
                    className={`toggle-thumb ${enrolledModules.has("GLOBAL_ECOMMERCE_SELLER") ? "toggle-thumb-on" : "toggle-thumb-off"}`}
                  />
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* ── Surface Modal ── */}
      <Modal
        isOpen={surfaceModalOpen}
        onClose={closeSurfaceModal}
        title={editingSurface ? t("surfaces.editSurface") : t("surfaces.createSurface")}
      >
        <div className="modal-form-col">
          <div>
            <label className="form-label-block">
              {t("surfaces.name")}
            </label>
            <input
              type="text"
              value={surfaceName}
              onChange={(e) => setSurfaceName(e.target.value)}
              placeholder={t("surfaces.namePlaceholder")}
              className="input-full"
            />
          </div>
          <div>
            <label className="form-label-block">
              {t("surfaces.descriptionLabel")}
            </label>
            <input
              type="text"
              value={surfaceDescription}
              onChange={(e) => setSurfaceDescription(e.target.value)}
              placeholder={t("surfaces.descriptionPlaceholder")}
              className="input-full"
            />
          </div>
          <div>
            <label className="form-label-block">
              {t("surfaces.allowedToolIds")}
            </label>
            <div className="form-hint">{t("surfaces.allowedToolIdsHint")}</div>
            <ToolMultiSelect selected={surfaceToolIds} onChange={setSurfaceToolIds} />
          </div>

          {editingSurface && (() => {
            const currentAllowed = surfaceToolIds;
            const childProfiles = profiles.filter((p) => p.surfaceId === editingSurface.id);
            const affectedProfiles = childProfiles.filter((p) =>
              p.selectedToolIds.some((tid) => currentAllowed.size > 0 && !currentAllowed.has(tid)),
            );
            if (affectedProfiles.length === 0) return null;
            return (
              <div className="form-warning">
                {t("surfaces.surfaceNarrowWarning", { count: affectedProfiles.length })}
                <ul className="form-warning-list">
                  {affectedProfiles.map((p) => <li key={p.id}>{p.name}</li>)}
                </ul>
              </div>
            );
          })()}

          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={closeSurfaceModal}>
              {t("common.cancel")}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSaveSurface}
              disabled={!surfaceName.trim() || savingSurface}
            >
              {savingSurface ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Preset Modal ── */}
      <Modal
        isOpen={presetModalOpen}
        onClose={() => setPresetModalOpen(false)}
        title={t("surfaces.createFromPreset")}
      >
        <div className="modal-form-col">
          <div>
            <label className="form-label-block">
              {t("surfaces.presetLabel")}
            </label>
            <Select
              value={selectedPresetId}
              onChange={setSelectedPresetId}
              placeholder={t("surfaces.selectPreset")}
              className="input-full"
              options={surfaces.map((s) => ({
                value: s.id,
                label: s.name,
                description: s.description ?? undefined,
              }))}
            />
          </div>

          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={() => setPresetModalOpen(false)}>
              {t("common.cancel")}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleCreateFromPreset}
              disabled={!selectedPresetId || savingSurface}
            >
              {savingSurface ? t("common.loading") : t("common.add")}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── RunProfile Modal ── */}
      <Modal
        isOpen={profileModalOpen}
        onClose={closeProfileModal}
        title={editingProfile ? t("surfaces.editRunProfile") : t("surfaces.createRunProfile")}
      >
        <div className="modal-form-col">
          {!editingProfile && (
            <div>
              <label className="form-label-block">
                {t("surfaces.surfacesTitle")}
              </label>
              <Select
                value={profileSurfaceId}
                onChange={setProfileSurfaceId}
                className="input-full"
                options={surfaces.map((s) => ({
                  value: s.id,
                  label: s.name,
                  description: s.description ?? undefined,
                }))}
              />
            </div>
          )}
          <div>
            <label className="form-label-block">
              {t("surfaces.profileName")}
            </label>
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder={t("surfaces.profileNamePlaceholder")}
              className="input-full"
            />
          </div>
          <div>
            <label className="form-label-block">
              {t("surfaces.selectedToolIds")}
            </label>
            <div className="form-hint">{t("surfaces.selectedToolIdsHint")}</div>
            <ToolMultiSelect
              selected={profileToolIds}
              onChange={setProfileToolIds}
              allowedToolIds={surfaces.find((s) => s.id === profileSurfaceId)?.allowedToolIds}
            />
          </div>

          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={closeProfileModal}>
              {t("common.cancel")}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSaveProfile}
              disabled={!profileName.trim() || !profileSurfaceId || savingProfile}
            >
              {savingProfile ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

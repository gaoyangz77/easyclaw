import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchInstalledSkills,
  deleteSkill,
  openSkillsFolder,
  trackEvent,
} from "../api/index.js";
import type { InstalledSkill } from "../api/index.js";
import { ConfirmDialog } from "../components/modals/ConfirmDialog.js";
import { SkillCard } from "../components/SkillCard.js";
import { useToast } from "../components/Toast.js";

export function SkillsPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [installedLoading, setInstalledLoading] = useState(false);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const loadInstalled = useCallback(async () => {
    setInstalledLoading(true);
    try {
      const skills = await fetchInstalledSkills();
      setInstalledSkills(skills);
    } catch {
      // silent — installed list is non-critical
    } finally {
      setInstalledLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInstalled();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDelete(slug: string) {
    setDeletingSlug(slug);
    setConfirmDelete(null);
    try {
      const result = await deleteSkill(slug);
      if (!result.ok) {
        showToast(t("skills.deleteError", { error: result.error ?? "" }), "error");
        return;
      }
      trackEvent("skills.delete", { slug });
      await loadInstalled();
    } catch (err) {
      showToast(t("skills.deleteError", { error: String(err) }), "error");
    } finally {
      setDeletingSlug(null);
    }
  }

  const deletingSkillName =
    confirmDelete
      ? (installedSkills.find((s) => s.slug === confirmDelete)?.name ?? confirmDelete)
      : "";

  return (
    <div className="page-enter skills-page">
      <div className="skills-page-header">
        <h1>{t("skills.title")}</h1>
        <p className="skills-page-subtitle">{t("skills.description")}</p>
      </div>

      <div className="skills-installed-header">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => openSkillsFolder()}
        >
          {t("skills.openFolder")}
        </button>
      </div>

      {installedLoading && (
        <p className="text-muted">{t("common.loading")}</p>
      )}

      {!installedLoading && installedSkills.length === 0 && (
        <div className="empty-state">
          <p>{t("skills.emptyInstalled")}</p>
        </div>
      )}

      {!installedLoading && installedSkills.length > 0 && (
        <div className="skills-grid">
          {installedSkills.map((skill) => (
            <SkillCard
              key={skill.slug}
              slug={skill.slug}
              nameEn={skill.name}
              nameZh={skill.name}
              descEn={skill.description}
              descZh={skill.description}
              author={skill.author}
              version={skill.version}
              stars={0}
              downloads={0}
              isBundled={false}
              isInstalled={true}
              isInstalling={false}
              onInstall={() => { }}
              variant="installed"
              isDeleting={deletingSlug === skill.slug}
              onDelete={() => setConfirmDelete(skill.slug)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title={t("skills.confirmDelete")}
        message={t("skills.confirmDeleteDesc", { name: deletingSkillName })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        confirmVariant="danger"
        onConfirm={() => {
          if (confirmDelete) handleDelete(confirmDelete);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

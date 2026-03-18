import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@apollo/client/react";
import { GQL } from "@rivonclaw/core";
import { SKILLS_QUERY } from "../api/skills-queries.js";
import {
  fetchInstalledSkills,
  fetchBundledSlugs,
  installSkill,
  deleteSkill,
  openSkillsFolder,
  trackEvent,
} from "../api/index.js";
import type { InstalledSkill } from "../api/index.js";
import { ConfirmDialog } from "../components/modals/ConfirmDialog.js";
import { SkillCard } from "../components/SkillCard.js";

const PAGE_SIZE = 12;

export function SkillsPage() {
  const { t, i18n } = useTranslation();
  const isCN = i18n.language === "zh";

  // Tab state — default to essential (featured)
  const [activeTab, setActiveTab] = useState<"market" | "essential" | "installed">("market");

  // Market state
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; detail?: string } | null>(null);

  // Installed state
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [installedLoading, setInstalledLoading] = useState(false);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Bundled (system default) skills
  const [bundledSlugs, setBundledSlugs] = useState<Set<string>>(new Set());

  // Derived set for quick lookup
  const installedSlugs = useMemo(
    () => new Set(installedSkills.map((s) => s.slug)),
    [installedSkills],
  );

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Apollo query for market skills
  const { data: marketData, loading, error: gqlError } = useQuery<{ skills: GQL.SkillConnection }>(
    SKILLS_QUERY,
    {
      variables: {
        query: debouncedQuery || undefined,
        category: selectedCategory || undefined,
        page,
        pageSize: PAGE_SIZE,
        chinaAvailable: isCN ? true : undefined,
      },
    },
  );

  const marketSkills = marketData?.skills.skills ?? [];
  const total = marketData?.skills.total ?? 0;

  // Featured/essential skills — filter by RECOMMENDED label from market data
  const featuredSkills = useMemo(
    () => marketSkills.filter((s) => s.labels.includes(GQL.SkillLabel.Recommended)),
    [marketSkills],
  );

  // Surface GraphQL errors
  useEffect(() => {
    if (gqlError) {
      setError({ key: "skills.installError", detail: gqlError.message });
    }
  }, [gqlError]);

  // Fetch installed skills when switching to installed tab
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
    if (activeTab === "installed") {
      loadInstalled();
    }
  }, [activeTab, loadInstalled]);

  // Also load installed on mount so installedSlugs is populated for market tab
  useEffect(() => {
    loadInstalled();
    fetchBundledSlugs().then(setBundledSlugs).catch(() => { });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle install
  async function handleInstall(skill: GQL.Skill) {
    setInstallingSlug(skill.slug);
    setError(null);
    try {
      const displayName = isCN ? skill.name_zh || skill.name_en : skill.name_en;
      const displayDesc = isCN ? skill.desc_zh || skill.desc_en : skill.desc_en;
      const result = await installSkill(skill.slug, i18n.language, {
        name: displayName,
        description: displayDesc,
        author: skill.author,
        version: skill.version,
      });
      if (!result.ok) {
        setError({ key: "skills.installError", detail: result.error });
        return;
      }
      trackEvent("skills.install", { slug: skill.slug });
      await loadInstalled();
    } catch (err) {
      setError({ key: "skills.installError", detail: String(err) });
    } finally {
      setInstallingSlug(null);
    }
  }

  // Handle delete
  async function handleDelete(slug: string) {
    setDeletingSlug(slug);
    setConfirmDelete(null);
    setError(null);
    try {
      const result = await deleteSkill(slug);
      if (!result.ok) {
        setError({ key: "skills.deleteError", detail: result.error });
        return;
      }
      trackEvent("skills.delete", { slug });
      await loadInstalled();
    } catch (err) {
      setError({ key: "skills.deleteError", detail: String(err) });
    } finally {
      setDeletingSlug(null);
    }
  }

  // Derive categories from market skills
  const categories = useMemo(() => {
    const tagSet = new Set<string>();
    for (const skill of marketSkills) {
      for (const tag of skill.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort();
  }, [marketSkills]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Find the installed skill name for confirm dialog
  const deletingSkillName = useMemo(() => {
    if (!confirmDelete) return "";
    const skill = installedSkills.find((s) => s.slug === confirmDelete);
    return skill?.name ?? confirmDelete;
  }, [confirmDelete, installedSkills]);

  return (
    <div className="page-enter skills-page">
      <div className="skills-page-header">
        <h1>{t("skills.title")}</h1>
        <p className="skills-page-subtitle">{t("skills.description")}</p>
      </div>

      {error && (
        <div className="error-alert">
          {t(error.key, { error: error.detail ?? "" })}
        </div>
      )}

      {/* Tab bar */}
      <div className="tab-bar" role="tablist" aria-label={t("skills.title")}>
        <button
          className={`tab-btn${activeTab === "market" ? " tab-btn-active" : ""}`}
          onClick={() => setActiveTab("market")}
          role="tab"
          aria-selected={activeTab === "market"}
        >
          {t("skills.tabMarket")}
        </button>
        <button
          className={`tab-btn${activeTab === "installed" ? " tab-btn-active" : ""}`}
          onClick={() => setActiveTab("installed")}
          role="tab"
          aria-selected={activeTab === "installed"}
        >
          {t("skills.tabInstalled")}
        </button>
      </div>

      {/* Essential tab */}
      {activeTab === "essential" && (
        <>
          {loading && <p className="text-muted">{t("common.loading")}</p>}
          {!loading && featuredSkills.length > 0 && (
            <div className="skills-grid">
              {featuredSkills.map((skill) => (
                <SkillCard
                  key={skill.slug}
                  slug={skill.slug}
                  nameEn={skill.name_en}
                  nameZh={skill.name_zh}
                  descEn={skill.desc_en}
                  descZh={skill.desc_zh}
                  author={skill.author}
                  version={skill.version}
                  stars={skill.stars}
                  downloads={skill.downloads}
                  labels={skill.labels}
                  isBundled={bundledSlugs.has(skill.slug)}
                  isInstalled={installedSlugs.has(skill.slug)}
                  isInstalling={installingSlug === skill.slug}
                  onInstall={() => handleInstall(skill)}
                />
              ))}
            </div>
          )}
          {!loading && featuredSkills.length === 0 && (
            <div className="empty-state">{t("skills.emptyEssential")}</div>
          )}
        </>
      )}

      {/* Market tab */}
      {activeTab === "market" && (
        <>
          {/* Search bar */}
          <div className="skills-search-bar">
            <input
              className="skills-search-input"
              type="text"
              placeholder={t("skills.search")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Category chips */}
          {categories.length > 0 && (
            <div className="skills-category-chips">
              <button
                className={`btn btn-sm ${selectedCategory === "" ? "btn-outline" : "btn-secondary"}`}
                onClick={() => {
                  setSelectedCategory("");
                  setPage(1);
                }}
              >
                {t("skills.allCategories")}
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`btn btn-sm ${selectedCategory === cat ? "btn-outline" : "btn-secondary"}`}
                  onClick={() => {
                    setSelectedCategory(cat);
                    setPage(1);
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Loading */}
          {loading && <p className="text-muted">{t("common.loading")}</p>}

          {/* Skills grid */}
          {!loading && marketSkills.length > 0 && (
            <div className="skills-grid">
              {marketSkills.map((skill) => (
                <SkillCard
                  key={skill.slug}
                  slug={skill.slug}
                  nameEn={skill.name_en}
                  nameZh={skill.name_zh}
                  descEn={skill.desc_en}
                  descZh={skill.desc_zh}
                  author={skill.author}
                  version={skill.version}
                  stars={skill.stars}
                  downloads={skill.downloads}
                  labels={skill.labels}
                  isBundled={bundledSlugs.has(skill.slug)}
                  isInstalled={installedSlugs.has(skill.slug)}
                  isInstalling={installingSlug === skill.slug}
                  onInstall={() => handleInstall(skill)}
                />
              ))}
            </div>
          )}

          {/* Empty market */}
          {!loading && marketSkills.length === 0 && (
            <div className="empty-state">
              <p>{t("skills.emptyMarket")}</p>
            </div>
          )}

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <div className="skills-pagination">
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t("skills.prevPage")}
              </button>
              <span className="text-muted">
                {t("skills.pageInfo", { page, totalPages })}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t("skills.nextPage")}
              </button>
            </div>
          )}
        </>
      )}

      {/* Installed tab */}
      {activeTab === "installed" && (
        <>
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
        </>
      )}

      {/* Delete confirmation dialog */}
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

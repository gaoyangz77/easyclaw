import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchMarketSkills,
  fetchInstalledSkills,
  fetchBundledSlugs,
  installSkill,
  deleteSkill,
  openSkillsFolder,
  trackEvent,
} from "../api.js";
import type { MarketSkill, InstalledSkill, MarketResponse } from "../api.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";

const PAGE_SIZE = 12;

const LABEL_BADGE_MAP: Record<string, string> = {
  "推荐": "badge badge-info",
};

const LABEL_I18N_MAP: Record<string, string> = {
  "推荐": "skills.labelRecommended",
};

export function SkillsPage() {
  const { t, i18n } = useTranslation();
  const isCN = i18n.language === "zh";

  // Capture initial locale for API endpoint & chinaAvailable filter.
  // Switching display language should NOT re-fetch — both zh/en data is in the response.
  const initialIsCN = useRef(i18n.language === "zh").current;

  // Tab state
  const [activeTab, setActiveTab] = useState<"market" | "installed">("market");

  // Market state
  const [marketSkills, setMarketSkills] = useState<MarketSkill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ key: string; detail?: string } | null>(null);
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);

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

  // Fetch market skills
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMarketSkills({
      query: debouncedQuery || undefined,
      category: selectedCategory || undefined,
      page,
      pageSize: PAGE_SIZE,
      chinaAvailable: initialIsCN ? true : undefined,
      lang: initialIsCN ? "zh" : "en",
    })
      .then((data: MarketResponse) => {
        if (cancelled) return;
        setMarketSkills(data.skills);
        setTotal(data.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError({ key: "skills.installError", detail: String(err) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, selectedCategory, page]);

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
    fetchBundledSlugs().then(setBundledSlugs).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle install
  async function handleInstall(skill: MarketSkill) {
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
    <div>
      <h1>{t("skills.title")}</h1>
      <p>{t("skills.description")}</p>

      {error && (
        <div className="error-alert">
          {t(error.key, { error: error.detail ?? "" })}
        </div>
      )}

      {/* Tab bar */}
      <div className="skills-tab-bar">
        <button
          className={`btn ${activeTab === "market" ? "btn-outline" : "btn-secondary"}`}
          onClick={() => setActiveTab("market")}
        >
          {t("skills.tabMarket")}
        </button>
        <button
          className={`btn ${activeTab === "installed" ? "btn-outline" : "btn-secondary"}`}
          onClick={() => setActiveTab("installed")}
        >
          {t("skills.tabInstalled")}
        </button>
      </div>

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
                <div key={skill.slug} className="section-card">
                  <div className="skill-card-name">
                    {isCN ? skill.name_zh || skill.name_en : skill.name_en}
                  </div>
                  <div className="skill-card-desc">
                    {isCN ? skill.desc_zh || skill.desc_en : skill.desc_en}
                  </div>
                  {skill.labels.length > 0 && (
                    <div className="skill-card-labels">
                      {skill.labels.map((label) => (
                        <span
                          key={label}
                          className={LABEL_BADGE_MAP[label] ?? "badge badge-muted"}
                        >
                          {LABEL_I18N_MAP[label] ? t(LABEL_I18N_MAP[label]) : label}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="skill-card-meta">
                    <span>{t("skills.author", { author: skill.author })}</span>
                    <span>{t("skills.version", { version: skill.version })}</span>
                    <span>{t("skills.stars", { count: skill.stars })}</span>
                    <span>{t("skills.downloads", { count: skill.downloads })}</span>
                  </div>
                  <div className="skill-card-actions">
                    {bundledSlugs.has(skill.slug) ? (
                      <button className="btn btn-secondary btn-sm" disabled>
                        {t("skills.builtIn")}
                      </button>
                    ) : installedSlugs.has(skill.slug) ? (
                      <button className="btn btn-secondary btn-sm" disabled>
                        {t("skills.installed")}
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={installingSlug === skill.slug}
                        onClick={() => handleInstall(skill)}
                      >
                        {installingSlug === skill.slug
                          ? t("skills.installing")
                          : t("skills.install")}
                      </button>
                    )}
                  </div>
                </div>
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
            <div className="skills-installed-list">
              {installedSkills.map((skill) => (
                <div key={skill.slug} className="section-card">
                  <div className="skill-installed-row">
                    <div className="skill-installed-info">
                      <div className="skill-installed-name">{skill.name}</div>
                      <div className="skill-installed-meta">
                        {t("skills.author", { author: skill.author })}
                        {" · "}
                        {t("skills.version", { version: skill.version })}
                      </div>
                      {skill.description && (
                        <div className="skill-card-desc">
                          {skill.description}
                        </div>
                      )}
                    </div>
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={deletingSlug === skill.slug}
                      onClick={() => setConfirmDelete(skill.slug)}
                    >
                      {deletingSlug === skill.slug
                        ? t("skills.deleting")
                        : t("skills.delete")}
                    </button>
                  </div>
                </div>
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

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { GQL } from "@rivonclaw/core";

const LABEL_BADGE_MAP: Record<string, string> = {
    [GQL.SkillLabel.Recommended]: "badge badge-info",
};

const LABEL_I18N_MAP: Record<string, string> = {
    [GQL.SkillLabel.Recommended]: "skills.labelRecommended",
};

export interface SkillCardProps {
    slug: string;
    nameEn: string;
    nameZh: string;
    descEn: string;
    descZh: string;
    author: string;
    version: string;
    stars: number;
    downloads: number;
    labels?: string[];
    isBundled: boolean;
    isInstalled: boolean;
    isInstalling: boolean;
    onInstall: () => void;
    /** "market" (default) shows full card; "installed" hides stats and shows delete action */
    variant?: "market" | "installed";
    isDeleting?: boolean;
    onDelete?: () => void;
}

export function SkillCard({
    slug, nameEn, nameZh, descEn, descZh,
    author, version, stars, downloads, labels,
    isBundled, isInstalled, isInstalling, onInstall,
    variant = "market", isDeleting, onDelete,
}: SkillCardProps) {
    const { t, i18n } = useTranslation();
    const isCN = i18n.language === "zh";

    const name = isCN ? (nameZh || nameEn) : (nameEn || nameZh);
    const desc = isCN ? (descZh || descEn) : (descEn || descZh);

    const [copied, setCopied] = useState(false);
    const handleSlugDblClick = useCallback(() => {
        navigator.clipboard.writeText(slug).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }, [slug]);

    const showStats = variant === "market";

    return (
        <div className="section-card skill-market-card">
            <div className="skill-card-header">
                <div className="skill-card-name">{name}</div>
                {version && <span className="skill-card-version">v{version}</span>}
            </div>
            <div
                className="skill-card-slug"
                onDoubleClick={handleSlugDblClick}
                title={t("skills.dblClickCopy")}
            >
                {slug}
                {copied && <span className="skill-card-copied">{t("skills.copied")}</span>}
            </div>
            <div className="skill-card-desc">{desc}</div>
            {labels && labels.length > 0 && (
                <div className="skill-card-labels">
                    {labels.map((label) => (
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
                {author && <span className="skill-meta-author">{t("skills.author", { author })}</span>}
                {showStats && (
                    <span className="skill-meta-stats">
                        <span className="skill-meta-icon">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                            {stars}
                        </span>
                        <span className="skill-meta-icon">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                            {downloads}
                        </span>
                    </span>
                )}
            </div>
            <div className="skill-card-actions">
                {variant === "installed" ? (
                    <button
                        className="btn btn-primary btn-action"
                        disabled={isDeleting}
                        onClick={onDelete}
                    >
                        {isDeleting ? t("skills.deleting") : t("skills.delete")}
                    </button>
                ) : isBundled ? (
                    <span className="btn btn-outline btn-action skill-install-btn skill-installed-label">
                        {t("skills.builtIn")}
                    </span>
                ) : isInstalled ? (
                    <span className="btn btn-outline btn-action skill-install-btn skill-installed-label">
                        ✓ {t("skills.installed")}
                    </span>
                ) : (
                    <button
                        className="btn btn-primary btn-action"
                        disabled={isInstalling}
                        onClick={onInstall}
                    >
                        {isInstalling ? t("skills.installing") : t("skills.install")}
                    </button>
                )}
            </div>
        </div>
    );
}

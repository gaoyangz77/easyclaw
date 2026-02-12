import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { fetchUpdateInfo } from "../api.js";
import type { UpdateInfo } from "../api.js";

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 240;

type ThemePreference = "system" | "light" | "dark";

function getInitialPreference(): ThemePreference {
  const stored = localStorage.getItem("theme");
  if (stored === "system" || stored === "dark" || stored === "light") return stored;
  return "system";
}

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function Layout({
  children,
  currentPath,
  onNavigate,
}: {
  children: ReactNode;
  currentPath: string;
  onNavigate: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(getInitialPreference);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(getSystemTheme);
  const isDragging = useRef(false);

  const effectiveTheme = themePreference === "system" ? systemTheme : themePreference;

  useEffect(() => {
    fetchUpdateInfo()
      .then((info) => {
        if (info.currentVersion) setCurrentVersion(info.currentVersion);
        if (info.updateAvailable) setUpdateInfo(info);
      })
      .catch(() => {
        // Silently ignore — update check is best-effort
      });
  }, []);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const newWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX));
      setSidebarWidth(newWidth);
    }
    function onMouseUp() {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const NAV_ITEMS = [
    { path: "/", label: t("nav.chat") },
    { path: "/rules", label: t("nav.rules") },
    { path: "/providers", label: t("nav.providers") },
    { path: "/channels", label: t("nav.channels") },
    { path: "/permissions", label: t("nav.permissions") },
    { path: "/stt", label: t("nav.stt") },
    { path: "/usage", label: t("nav.usage") },
    // { path: "/settings", label: t("nav.settings") },
  ];

  // Listen for OS theme changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", effectiveTheme);
    localStorage.setItem("theme", themePreference);
  }, [effectiveTheme, themePreference]);

  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);

  // Close theme menu on outside click
  useEffect(() => {
    if (!themeMenuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [themeMenuOpen]);

  const THEME_ICON: Record<ThemePreference, string> = { system: "\u{1F5A5}", light: "\u{2600}\u{FE0F}", dark: "\u{263E}" };

  function toggleLang() {
    i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh");
  }

  const showBanner = updateInfo && !dismissed;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {showBanner && (
        <div className="update-banner">
          <span className="flex-1">
            {t("update.bannerText", { version: updateInfo.latestVersion })}
            {updateInfo.downloadUrl && (
              <>
                {" "}
                <a
                  href={updateInfo.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("update.download")}
                </a>
              </>
            )}
          </span>
          <button
            className="update-banner-dismiss"
            onClick={() => setDismissed(true)}
          >
            {t("update.dismiss")}
          </button>
        </div>
      )}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <nav className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
          <h2 className="sidebar-brand">
            <img src="/logo.png" alt="" style={{ width: 28, height: 28 }} />
            {t("common.brandName")}
            {currentVersion && (
              <span className="sidebar-version">v{currentVersion}</span>
            )}
          </h2>
          <ul className="nav-list">
            {NAV_ITEMS.map((item) => {
              const active = currentPath === item.path;
              return (
                <li key={item.path}>
                  <button
                    className={`nav-btn ${active ? "nav-active" : "nav-item"}`}
                    onClick={() => onNavigate(item.path)}
                  >
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="theme-menu-wrapper" ref={themeMenuRef}>
            <button
              className="theme-menu-trigger"
              onClick={() => setThemeMenuOpen((v) => !v)}
              title={t(`theme.${themePreference}`)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a10 10 0 0 0 0 20z" fill="currentColor" />
              </svg>
            </button>
            {themeMenuOpen && (
              <div className="theme-menu-popup">
                {(["system", "light", "dark"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`theme-menu-option${themePreference === mode ? " theme-menu-option-active" : ""}`}
                    onClick={() => { setThemePreference(mode); setThemeMenuOpen(false); }}
                  >
                    <span className="theme-menu-option-icon">{THEME_ICON[mode]}</span>
                    <span>{t(`theme.${mode}`)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div
            className="sidebar-resize-handle"
            onMouseDown={handleMouseDown}
          />
        </nav>
        <div className="main-content">
          <div className="topbar">
            <button
              className="btn btn-secondary"
              onClick={toggleLang}
            >
              {i18n.language === "zh" ? "English" : "中文"}
            </button>
          </div>
          <main>{children}</main>
        </div>
      </div>
    </div>
  );
}

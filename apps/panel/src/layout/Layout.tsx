import { useState, useEffect, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { fetchUpdateInfo } from "../api.js";
import type { UpdateInfo } from "../api.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { LangToggle } from "../components/LangToggle.js";

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 240;

const NAV_ICONS: Record<string, ReactNode> = {
  "/": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  "/rules": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  "/providers": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  ),
  "/channels": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.4" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4" />
      <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
    </svg>
  ),
  "/permissions": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  "/stt": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
  "/usage": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
};

export function Layout({
  children,
  currentPath,
  onNavigate,
  agentName,
}: {
  children: ReactNode;
  currentPath: string;
  onNavigate: (path: string) => void;
  agentName?: string | null;
}) {
  const { t } = useTranslation();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "true");
  const isDragging = useRef(false);

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

  function handleToggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
  }

  const handleMouseDown = useCallback(() => {
    if (collapsed) return;
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [collapsed]);

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

  const showBanner = updateInfo && !dismissed;

  return (
    <div className="layout-root">
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
      <div className="layout-body">
        <nav
          className={`sidebar${collapsed ? " sidebar-collapsed" : ""}`}
          style={collapsed ? undefined : { width: sidebarWidth, minWidth: sidebarWidth }}
        >
          <button
            className="sidebar-collapse-toggle"
            onClick={handleToggleCollapse}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <h2 className="sidebar-brand">
            <img src="/logo.png" alt="" className="sidebar-brand-logo" />
            {!collapsed && (
              <>
                <span className="sidebar-brand-text">{agentName && agentName !== "Assistant" ? agentName : t("common.brandName")}</span>
                {currentVersion && (
                  <span className="sidebar-version">v{currentVersion}</span>
                )}
              </>
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
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="nav-icon">{NAV_ICONS[item.path]}</span>
                    {!collapsed && <span className="nav-label">{item.label}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className={`sidebar-bottom-actions${collapsed ? " sidebar-bottom-actions-collapsed" : ""}`}>
            <ThemeToggle />
            <LangToggle />
          </div>
          {!collapsed && (
            <div
              className="sidebar-resize-handle"
              onMouseDown={handleMouseDown}
            />
          )}
        </nav>
        <div className="main-content">
          <main>{children}</main>
        </div>
      </div>
    </div>
  );
}

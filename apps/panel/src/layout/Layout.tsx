import { useState, useEffect, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchUpdateInfo,
  startUpdateDownload,
  cancelUpdateDownload,
  fetchUpdateDownloadStatus,
  triggerUpdateInstall,
} from "../api/index.js";
import { formatError } from "@rivonclaw/core";
import type { UpdateInfo, UpdateDownloadStatus } from "../api/index.js";
import { BottomActions } from "../components/BottomActions.js";
import {
  ChatIcon, RulesIcon, ProvidersIcon, ChannelsIcon, AppsIcon,
  PermissionsIcon, ExtrasIcon, UsageIcon, SkillsIcon,
  BrowserProfilesIcon, CronsIcon, SettingsIcon, AccountIcon,
  AuthIcon, MenuIcon,
} from "../components/icons.js";
import { useAuth } from "../providers/AuthProvider.js";
import { AuthModal } from "../components/modals/AuthModal.js";

const AUTH_REQUIRED_PATHS = new Set(["/browser-profiles"]);

const SIDEBAR_MIN = 140;
const SIDEBAR_MAX = 360;
const SIDEBAR_DEFAULT = 200;

const NAV_ICONS: Record<string, ReactNode> = {
  "/": <ChatIcon />,
  "/rules": <RulesIcon />,
  "/providers": <ProvidersIcon />,
  "/channels": <ChannelsIcon />,
  "/apps": <AppsIcon />,
  "/permissions": <PermissionsIcon />,
  "/extras": <ExtrasIcon />,
  "/usage": <UsageIcon />,
  "/skills": <SkillsIcon />,
  "/browser-profiles": <BrowserProfilesIcon />,
  "/crons": <CronsIcon />,
  "/settings": <SettingsIcon />,
  "/account": <AccountIcon />,
  "/auth": <AuthIcon />,
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
  const { user } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [pendingAuthPath, setPendingAuthPath] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<UpdateDownloadStatus>({
    status: "idle",
  });
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebar-collapsed") === "true",
  );
  const isDragging = useRef(false);

  // Check for updates after 5s + retry once at 20s to handle startup race.
  // Also re-check when the window becomes visible (e.g. tray click triggers
  // showMainWindow + performUpdateDownload — without this the panel stays
  // unaware and shows no banner/progress).
  useEffect(() => {
    function check() {
      fetchUpdateInfo()
        .then((info) => {
          if (info.currentVersion) setCurrentVersion(info.currentVersion);
          if (info.updateAvailable) setUpdateInfo(info);
        })
        .catch(() => { });
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") check();
    }
    const firstTimer = setTimeout(check, 5_000);
    const retryTimer = setTimeout(check, 20_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(firstTimer);
      clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Poll download status: fast (500ms) when actively downloading, slow (3s) when banner is visible.
  // Also fetch immediately when the window becomes visible so progress appears instantly
  // after a tray-triggered download.
  useEffect(() => {
    if (!updateInfo) return;
    function poll() {
      fetchUpdateDownloadStatus()
        .then((s) => {
          setDownloadStatus(s);
        })
        .catch(() => { });
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") poll();
    }
    const active =
      downloadStatus.status === "downloading" ||
      downloadStatus.status === "verifying" ||
      downloadStatus.status === "installing";
    const interval = active ? 500 : 3000;
    const id = setInterval(poll, interval);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [downloadStatus.status, updateInfo]);

  function handleDownload() {
    setDownloadStatus({ status: "downloading", percent: 0 });
    startUpdateDownload().catch((err) => {
      setDownloadStatus({
        status: "error",
        message: formatError(err),
      });
    });
  }

  function handleCancel() {
    cancelUpdateDownload().catch(() => { });
    setDownloadStatus({ status: "idle" });
  }

  function handleInstall() {
    setDownloadStatus({ status: "installing" });
    triggerUpdateInstall().catch((err) => {
      setDownloadStatus({
        status: "error",
        message: formatError(err),
      });
    });
  }

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
    { path: "/providers", label: t("nav.providers") },
    { path: "/channels", label: t("nav.channels") },
    { path: "/rules", label: t("nav.rules") },
    { path: "/permissions", label: t("nav.permissions") },
    { path: "/extras", label: t("nav.extras") },
    { path: "/skills", label: t("nav.skills") },
    { path: "/browser-profiles", label: t("nav.browserProfiles") },
    { path: "/crons", label: t("nav.crons") },
    // { path: "/apps", label: t("customerService.nav") },
    { path: "/usage", label: t("nav.usage") },
    { path: "/settings", label: t("nav.settings") },
  ];

  const showBanner = !!updateInfo;
  const ds = downloadStatus;

  return (
    <div className="layout-root">
      {showBanner && (
        <div className="update-banner">
          <span className="update-banner-content">
            {ds.status === "idle" && (
              <>
                {t("update.bannerText", { version: updateInfo.latestVersion })}{" "}
                <button
                  className="update-banner-action"
                  onClick={handleDownload}
                >
                  {t("update.download")}
                </button>
              </>
            )}
            {ds.status === "downloading" && (
              <>
                {t("update.downloading", { percent: ds.percent ?? 0 })}
                <span className="update-progress-bar">
                  <span
                    className="update-progress-fill"
                    style={{ width: `${ds.percent ?? 0}%` }}
                  />
                </span>
                <button className="update-banner-action" onClick={handleCancel}>
                  {t("update.cancel")}
                </button>
              </>
            )}
            {ds.status === "verifying" && t("update.verifying")}
            {ds.status === "ready" && (
              <>
                {t("update.ready")}{" "}
                <button
                  className="update-banner-action update-banner-action-primary"
                  onClick={handleInstall}
                >
                  {t("update.installRestart")}
                </button>
              </>
            )}
            {ds.status === "installing" && t("update.installing")}
            {ds.status === "error" && (
              <>
                {t("update.error", { message: ds.message ?? "" })}{" "}
                <button
                  className="update-banner-action"
                  onClick={handleDownload}
                >
                  {t("update.retry")}
                </button>
              </>
            )}
          </span>
        </div>
      )}
      <div className="layout-body">
        <nav
          className={`sidebar${collapsed ? " sidebar-collapsed" : ""}`}
          style={
            collapsed
              ? undefined
              : { width: sidebarWidth, minWidth: sidebarWidth }
          }
        >
          <button
            className="sidebar-collapse-toggle"
            onClick={handleToggleCollapse}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
          >
            <MenuIcon />
          </button>
          <h2 className="sidebar-brand">
            <img src="/logo.png" alt="" className="sidebar-brand-logo" />
            {!collapsed && (
              <>
                <span className="sidebar-brand-text">
                  {agentName && agentName !== "Assistant"
                    ? agentName
                    : t("common.brandName")}
                </span>
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
                    onClick={() => {
                      if (AUTH_REQUIRED_PATHS.has(item.path) && !user) {
                        setPendingAuthPath(item.path);
                        setAuthModalOpen(true);
                      } else {
                        onNavigate(item.path);
                      }
                    }}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="nav-icon">{NAV_ICONS[item.path]}</span>
                    {!collapsed && (
                      <span className="nav-label">{item.label}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <BottomActions collapsed={collapsed} onNavigate={onNavigate} />
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
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => { setAuthModalOpen(false); setPendingAuthPath(null); }}
        onSuccess={() => { if (pendingAuthPath) onNavigate(pendingAuthPath); }}
      />
    </div>
  );
}

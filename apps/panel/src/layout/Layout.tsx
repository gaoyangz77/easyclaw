import { useState, useEffect, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { fetchUpdateInfo } from "../api.js";
import type { UpdateInfo } from "../api.js";

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 240;

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
  const isDragging = useRef(false);

  useEffect(() => {
    fetchUpdateInfo()
      .then((info) => {
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
    // TODO: Unhide after server-side telemetry receiver is deployed (see PROGRESS.md V1)
    // { path: "/settings", label: t("nav.settings") },
  ];

  function toggleLang() {
    i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh");
  }

  const showBanner = updateInfo && !dismissed;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
        <h2 className="sidebar-brand">{t("common.brandName")}</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, flex: 1 }}>
          {NAV_ITEMS.map((item) => {
            const active = currentPath === item.path;
            return (
              <li key={item.path} style={{ marginBottom: 2 }}>
                <button
                  className={active ? "nav-active" : "nav-item"}
                  onClick={() => onNavigate(item.path)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "9px 14px",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 14,
                    color: active ? undefined : "#374151",
                    backgroundColor: active ? undefined : "transparent",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
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
        {showBanner && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "8px 16px",
              backgroundColor: "#eff6ff",
              borderBottom: "1px solid #bfdbfe",
              fontSize: 13,
              color: "#1e40af",
            }}
          >
            <span style={{ flex: 1 }}>
              {t("update.bannerText", { version: updateInfo.latestVersion })}
              {updateInfo.downloadUrl && (
                <>
                  {" "}
                  <a
                    href={updateInfo.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#1d4ed8", fontWeight: 500 }}
                  >
                    {t("update.download")}
                  </a>
                </>
              )}
            </span>
            <button
              onClick={() => setDismissed(true)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#1e40af",
                fontSize: 13,
                padding: "2px 6px",
              }}
            >
              {t("update.dismiss")}
            </button>
          </div>
        )}
        <main>{children}</main>
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

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

  const NAV_ITEMS = [
    { path: "/", label: t("nav.rules") },
    { path: "/providers", label: t("nav.providers") },
    { path: "/channels", label: t("nav.channels") },
    { path: "/permissions", label: t("nav.permissions") },
    { path: "/stt", label: t("nav.stt") },
    { path: "/usage", label: t("nav.usage") },
    { path: "/settings", label: t("nav.settings") },
  ];

  function toggleLang() {
    i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav className="sidebar">
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
                  }}
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
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
  );
}

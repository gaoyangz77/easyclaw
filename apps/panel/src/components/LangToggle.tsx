import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent } from "../api/index.js";
import { GlobeIcon } from "./icons.js";

export function LangToggle({ popupDirection = "up" }: { popupDirection?: "up" | "down" }) {
  const { t, i18n } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  return (
    <div className="lang-menu-wrapper" ref={menuRef}>
      <button
        className="lang-menu-trigger"
        onClick={() => setMenuOpen((v) => !v)}
        title={t("common.language")}
      >
        <GlobeIcon />
      </button>
      {menuOpen && (
        <div className={`lang-menu-popup ${popupDirection === "down" ? "lang-menu-popup-down" : ""}`}>
          <button
            className={`lang-menu-option${i18n.language === "en" ? " lang-menu-option-active" : ""}`}
            onClick={() => { i18n.changeLanguage("en"); setMenuOpen(false); trackEvent("ui.language_changed", { language: "en" }); }}
          >
            English
          </button>
          <button
            className={`lang-menu-option${i18n.language === "zh" ? " lang-menu-option-active" : ""}`}
            onClick={() => { i18n.changeLanguage("zh"); setMenuOpen(false); trackEvent("ui.language_changed", { language: "zh" }); }}
          >
            中文
          </button>
        </div>
      )}
    </div>
  );
}

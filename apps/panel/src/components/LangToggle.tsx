import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent } from "../api/index.js";
import { GlobeIcon } from "./icons.js";
import { LANGUAGES } from "../i18n/index.js";

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
          {LANGUAGES.map(({ code, label }) => (
            <button
              key={code}
              className={`lang-menu-option${i18n.language === code ? " lang-menu-option-active" : ""}`}
              onClick={() => { i18n.changeLanguage(code); setMenuOpen(false); trackEvent("ui.language_changed", { language: code }); }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

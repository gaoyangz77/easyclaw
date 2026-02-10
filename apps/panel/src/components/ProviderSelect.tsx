import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ALL_PROVIDERS } from "@easyclaw/core";
import { fetchModelCatalog } from "../api.js";

/** Domestic Chinese LLM providers — shown first (in this order) when UI language is Chinese. */
const CHINA_FIRST_PROVIDERS = [
  "zhipu",
  "volcengine",
  "deepseek",
  "moonshot",
  "qwen",
  "minimax",
  "xiaomi",
];

export function ProviderSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (provider: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [catalogProviders, setCatalogProviders] = useState<Set<string> | null>(null);

  useEffect(() => {
    fetchModelCatalog().then((data) => {
      setCatalogProviders(new Set(Object.keys(data)));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sort: Chinese domestic providers first (in defined order) when UI language is Chinese
  const sortedProviders = useMemo(() => {
    const available = ALL_PROVIDERS.filter((p) => !catalogProviders || catalogProviders.has(p));
    if (i18n.language !== "zh") return available;
    const availableSet = new Set(available);
    const china = CHINA_FIRST_PROVIDERS.filter((p) => availableSet.has(p));
    const rest = available.filter((p) => !CHINA_FIRST_PROVIDERS.includes(p));
    return [...china, ...rest];
  }, [catalogProviders, i18n.language]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          padding: "8px 12px",
          borderRadius: 4,
          border: "1px solid #e0e0e0",
          backgroundColor: "#fff",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 14,
        }}
      >
        <span>
          <strong>{t(`providers.label_${value}`)}</strong>
          <span style={{ color: "#888", marginLeft: 8, fontSize: 12 }}>
            {t(`providers.desc_${value}`)}
          </span>
        </span>
        <span style={{ fontSize: 10, color: "#888" }}>{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            maxHeight: 320,
            overflowY: "auto",
            border: "1px solid #e0e0e0",
            borderRadius: 4,
            backgroundColor: "#fff",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            zIndex: 10,
            marginTop: 2,
          }}
        >
          {sortedProviders.map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "8px 12px",
                border: "none",
                borderBottom: "1px solid #f0f0f0",
                backgroundColor: p === value ? "#e3f2fd" : "transparent",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {t(`providers.label_${p}`)}
              </div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                {t(`providers.desc_${p}`)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

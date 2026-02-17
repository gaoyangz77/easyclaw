import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ALL_PROVIDERS, SUBSCRIPTION_PROVIDER_IDS, getProviderMeta } from "@easyclaw/core";
import type { LLMProvider } from "@easyclaw/core";
import { fetchModelCatalog } from "../api.js";

/** Providers with extraModels are always shown (statically defined, not catalog-dependent). */
const EXTRA_MODEL_PROVIDERS = new Set(
  ALL_PROVIDERS.filter((p) => getProviderMeta(p)?.extraModels),
);

/** Subscription plan providers are always shown (they share models with their parent). */
const SUBSCRIPTION_SET = new Set(SUBSCRIPTION_PROVIDER_IDS);

/** Priority-ordered providers by language. */
const ZH_PRIORITY_PROVIDERS: LLMProvider[] = [
  "zhipu-coding",
  "moonshot-coding",
  "minimax-coding",
  "gemini",
  "zhipu",
  "kimi",
  "volcengine",
  "deepseek",
  "qwen",
  "minimax-cn",
  "xiaomi",
];

const EN_PRIORITY_PROVIDERS: LLMProvider[] = [
  "gemini",
  "claude",
  "anthropic",
];

export function ProviderSelect({
  value,
  onChange,
  providers: filterProviders,
}: {
  value: string;
  onChange: (provider: string) => void;
  /** If provided, only these provider IDs are shown. */
  providers?: string[];
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

  // Sort providers by locale-specific priority, then alphabetically.
  const sortedProviders = useMemo(() => {
    const all = ALL_PROVIDERS.filter((p) =>
      EXTRA_MODEL_PROVIDERS.has(p) || SUBSCRIPTION_SET.has(p) || !catalogProviders || catalogProviders.has(p),
    );
    const available = filterProviders
      ? all.filter((p) => filterProviders.includes(p))
      : all;
    const priority = i18n.language === "zh" ? ZH_PRIORITY_PROVIDERS : EN_PRIORITY_PROVIDERS;
    const availableSet = new Set(available);
    const top = priority.filter((p) => availableSet.has(p));
    const rest = available.filter((p) => !priority.includes(p));
    return [...top, ...rest];
  }, [catalogProviders, i18n.language, filterProviders]);

  return (
    <div ref={ref} className="provider-select-wrap">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="provider-select-trigger"
      >
        <span>
          <strong>{t(`providers.label_${value}`)}</strong>
          <span className="provider-select-desc">
            {t(`providers.desc_${value}`)}
          </span>
        </span>
        <span className="provider-select-arrow">{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && (
        <div className="provider-select-dropdown">
          {sortedProviders.map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
              className={`provider-select-option${p === value ? " provider-select-option-active" : ""}`}
            >
              <div className="provider-select-option-label">
                {t(`providers.label_${p}`)}
              </div>
              <div className="provider-select-option-desc">
                {t(`providers.desc_${p}`)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

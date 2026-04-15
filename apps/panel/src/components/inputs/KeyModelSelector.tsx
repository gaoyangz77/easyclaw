import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import "./KeyModelSelector.css";

export interface KeyModelKey {
  id: string;
  provider: string;
  label: string;
  model: string;
  isDefault: boolean;
}

export interface CatalogModel {
  id: string;
  name: string;
  contextWindow?: number;
}

export interface KeyModelSelectorProps {
  /** All provider keys the user has configured */
  keys: KeyModelKey[];
  /** Full model catalog keyed by provider slug */
  catalog: Record<string, CatalogModel[]>;
  /** Currently selected provider slug */
  selectedProvider: string;
  /** Currently selected model ID */
  selectedModel: string;
  /** Callback when user selects a provider + model. */
  onChange: (provider: string, model: string) => void;
  /** Whether the selector is disabled */
  disabled?: boolean;
  /** Visual variant: "compact" for status bars (default), "form" for form layouts */
  variant?: "compact" | "form";
  /** When true, trigger shows "默认模型" when the selected provider is "openrouter". */
  creditsMode?: boolean;
}

/**
 * Two-level cascading selector: provider keys on the left, models on the right.
 * Replaces the single-level model dropdown in the chat status bar.
 */
export function KeyModelSelector({
  keys,
  catalog,
  selectedProvider,
  selectedModel,
  onChange,
  disabled,
  variant = "compact",
  creditsMode,
}: KeyModelSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hoveredProvider, setHoveredProvider] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const openedAtRef = useRef(0);

  // The provider whose models are shown in the right column
  const activeProvider = hoveredProvider ?? selectedProvider;

  // Deduplicate keys by provider: one row per provider, prefer the isDefault key's label.
  const sortedKeys = useMemo(() => {
    const byProvider = new Map<string, KeyModelKey>();
    for (const k of keys) {
      const existing = byProvider.get(k.provider);
      if (!existing || k.isDefault) byProvider.set(k.provider, k);
    }
    return [...byProvider.values()].sort((a, b) => {
      if (a.provider === selectedProvider && b.provider !== selectedProvider) return -1;
      if (b.provider === selectedProvider && a.provider !== selectedProvider) return 1;
      if (a.isDefault && !b.isDefault) return -1;
      if (b.isDefault && !a.isDefault) return 1;
      return a.label.localeCompare(b.label);
    });
  }, [keys, selectedProvider]);

  // Models for the active provider, filtered by search
  const activeModels = useMemo(() => {
    const models = catalog[activeProvider] ?? [];
    if (!search.trim()) return models;
    const q = search.trim().toLowerCase();
    return models.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  }, [catalog, activeProvider, search]);

  /** Compute dropdown position synchronously from the trigger's bounding rect. */
  function computePosition(): React.CSSProperties {
    if (!triggerRef.current) return { position: "fixed" as const, top: 0, left: 0 };
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownMaxHeight = 360;
    const openAbove = spaceBelow < dropdownMaxHeight && rect.top > spaceBelow;

    const dropdownWidth = 420;
    const overflowsRight = rect.left + dropdownWidth > window.innerWidth - 8;
    const horizontalStyle = overflowsRight
      ? { right: window.innerWidth - rect.right, left: "auto" as const }
      : { left: rect.left };

    return {
      position: "fixed" as const,
      ...(openAbove
        ? { bottom: window.innerHeight - rect.top + 4, maxHeight: rect.top - 8 }
        : { top: rect.bottom + 4, maxHeight: spaceBelow - 8 }),
      ...horizontalStyle,
    };
  }

  // Open/close side effects
  useEffect(() => {
    if (!open) {
      setSearch("");
      setHoveredProvider(null);
      return;
    }

    requestAnimationFrame(() => searchRef.current?.focus());

    function handleClickOutside(e: MouseEvent) {
      // Ignore clicks that happen within 200ms of opening (prevents race with trigger click)
      if (Date.now() - openedAtRef.current < 200) return;
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleScroll(e: Event) {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleResize() {
      setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [open]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Resolve display label for the trigger
  const hasSelection = !!(selectedProvider && selectedModel);
  const isCreditsDefault = creditsMode && selectedProvider === "openrouter";
  const providerLabel = hasSelection
    ? t(`providers.label_${selectedProvider}`, { defaultValue: selectedProvider })
    : "";
  const modelEntry = hasSelection ? catalog[selectedProvider]?.find((m) => m.id === selectedModel) : undefined;
  const modelLabel = hasSelection ? (modelEntry?.name ?? selectedModel) : "";

  function handleSelectModel(provider: string, modelId: string) {
    onChange(provider, modelId);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className={`key-model-selector${variant === "form" ? " key-model-selector-form" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="key-model-selector-trigger"
        onClick={() => {
          if (disabled) return;
          if (!open) {
            setDropdownStyle(computePosition());
            openedAtRef.current = Date.now();
          }
          setOpen((v) => !v);
        }}
        disabled={disabled}
      >
        <span className="key-model-selector-label">
          {isCreditsDefault ? (
            t("chat.creditsDefault", { defaultValue: "默认模型" })
          ) : hasSelection ? (
            <>
              {providerLabel}
              <span className="key-model-selector-sep">/</span>
              {modelLabel}
            </>
          ) : t("chat.creditsDefault", { defaultValue: "默认模型" })}
        </span>
        <span className="key-model-selector-chevron">{open ? "\u25B2" : "\u25BC"}</span>
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="key-model-selector-dropdown"
          style={dropdownStyle}
        >
          {/* Search bar */}
          <div className="key-model-selector-search-wrap">
            <input
              ref={searchRef}
              type="text"
              className="key-model-selector-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("chat.modelSearchPlaceholder", { defaultValue: "Search models..." })}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="key-model-selector-columns">
            {/* Left column: provider keys */}
            <div className="key-model-selector-keys">
              {sortedKeys.map((key) => (
                <button
                  type="button"
                  key={key.id}
                  className={`key-model-selector-key${key.provider === activeProvider && (hoveredProvider !== null || hasSelection) ? " key-model-selector-key-active" : ""}`}
                  onMouseEnter={() => setHoveredProvider(key.provider)}
                  onClick={() => setHoveredProvider(key.provider)}
                >
                  <span className="key-model-selector-key-label">
                    {key.label || t(`providers.label_${key.provider}`, { defaultValue: key.provider })}
                  </span>
                </button>
              ))}
              {sortedKeys.length === 0 && (
                <div className="key-model-selector-empty">
                  {t("chat.noProviderKeys", { defaultValue: "No provider keys" })}
                </div>
              )}
            </div>

            {/* Right column: models for active provider */}
            <div className="key-model-selector-models">
              {activeModels.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className={`key-model-selector-model${m.id === selectedModel && activeProvider === selectedProvider ? " key-model-selector-model-active" : ""}`}
                  onClick={() => handleSelectModel(activeProvider, m.id)}
                >
                  <span className="key-model-selector-model-name">{m.name}</span>
                  {m.contextWindow != null && m.contextWindow > 0 && (
                    <span className="key-model-selector-model-ctx">
                      {formatContextWindow(m.contextWindow)}
                    </span>
                  )}
                </button>
              ))}
              {activeModels.length === 0 && (
                <div className="key-model-selector-empty">
                  {search.trim()
                    ? t("chat.noModelsMatch", { defaultValue: "No matching models" })
                    : t("chat.noModels", { defaultValue: "No models available" })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Format a context window token count for compact display (e.g. "200K", "1M"). */
function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(0)}K`;
  }
  return String(tokens);
}

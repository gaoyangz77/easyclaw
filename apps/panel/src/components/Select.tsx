import { useState, useRef, useEffect } from "react";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function Select({ value, onChange, options, placeholder, disabled, style }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="custom-select" style={style}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
      >
        <span className={selected ? "custom-select-label" : "custom-select-placeholder"}>
          {selected ? selected.label : placeholder ?? ""}
        </span>
        <span className="custom-select-chevron">{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && (
        <div className="custom-select-dropdown">
          {options.map((opt) => (
            <button
              type="button"
              key={opt.value}
              className="custom-select-option"
              data-selected={opt.value === value || undefined}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <div className="custom-select-option-label">{opt.label}</div>
              {opt.description && (
                <div className="custom-select-option-desc">{opt.description}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

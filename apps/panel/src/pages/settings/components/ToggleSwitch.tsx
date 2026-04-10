export function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle-switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span
        className={`toggle-track ${checked ? "toggle-track-on" : "toggle-track-off"} ${disabled ? "toggle-track-disabled" : ""}`}
      >
        <span
          className={`toggle-thumb ${checked ? "toggle-thumb-on" : "toggle-thumb-off"}`}
        />
      </span>
    </label>
  );
}

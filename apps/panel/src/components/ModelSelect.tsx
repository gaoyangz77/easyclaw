import { useState, useEffect } from "react";
import { fetchModelCatalog } from "../api.js";
import type { CatalogModelEntry } from "../api.js";

export function ModelSelect({
  provider,
  value,
  onChange,
}: {
  provider: string;
  value: string;
  onChange: (modelId: string) => void;
}) {
  const [catalog, setCatalog] = useState<Record<string, CatalogModelEntry[]>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;

    function load() {
      fetchModelCatalog()
        .then((data) => {
          if (cancelled) return;
          setCatalog(data);
          if (Object.keys(data).length === 0) {
            // models.json not ready yet (gateway still starting), retry
            setTimeout(load, 2000);
          }
        })
        .catch(() => {
          if (!cancelled) setTimeout(load, 2000);
        });
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const models = (catalog[provider] ?? []).map((m) => ({
    modelId: m.id,
    displayName: m.name,
  }));

  // Auto-select first model when value is empty
  useEffect(() => {
    if (!value && models.length > 0) {
      onChange(models[0].modelId);
    }
  }, [value, models.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ensure the current value is always in the list (e.g. a custom model ID).
  if (value && !models.some((m) => m.modelId === value)) {
    models.push({ modelId: value, displayName: value });
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: 8,
        borderRadius: 4,
        border: "1px solid #e0e0e0",
        fontSize: 13,
        backgroundColor: "#fff",
        cursor: "pointer",
      }}
    >
      {models.map((m) => (
        <option key={m.modelId} value={m.modelId}>
          {m.displayName}
        </option>
      ))}
    </select>
  );
}

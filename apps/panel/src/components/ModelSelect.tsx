import { useState, useEffect } from "react";
import { fetchModelCatalog } from "../api/index.js";
import type { CatalogModelEntry } from "../api/index.js";
import { Select } from "./Select.js";

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
    <Select
      value={value}
      onChange={onChange}
      options={models.map((m) => ({ value: m.modelId, label: m.displayName }))}
    />
  );
}

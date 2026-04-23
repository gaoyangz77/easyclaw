import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { observer } from "mobx-react-lite";
import { useEntityStore } from "../../store/EntityStoreProvider.js";
import { useToolDisplayLabel } from "../../lib/tool-display.js";
import type { AvailableTool } from "@rivonclaw/core/models";

interface ToolMultiSelectProps {
  /** Currently selected tool IDs */
  selected: Set<string>;
  /** Called when selection changes */
  onChange: (selected: Set<string>) => void;
  /** If provided, only these tool IDs are selectable. Empty array = unrestricted. */
  allowedToolIds?: string[];
}

interface ToolListItem extends AvailableTool {
  unavailable?: boolean;
}

/**
 * Multi-select checkbox list of individual tools, grouped by category.
 * Categories are collapsible and show a source badge (System / Extensions / Cloud).
 */
export const ToolMultiSelect = observer(function ToolMultiSelect({ selected, onChange, allowedToolIds }: ToolMultiSelectProps) {
  const { t } = useTranslation();
  const entityStore = useEntityStore();
  const tools = entityStore.availableTools;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const allowedSet = useMemo(
    () => (allowedToolIds && allowedToolIds.length > 0 ? new Set(allowedToolIds) : null),
    [allowedToolIds],
  );

  const visibleToolIds = useMemo(() => new Set(tools.filter((tool) => !allowedSet || allowedSet.has(tool.id)).map((tool) => tool.id)), [tools, allowedSet]);

  const grouped = useMemo(() => {
    const map = new Map<string, ToolListItem[]>();
    for (const tool of tools) {
      if (allowedSet && !allowedSet.has(tool.id)) continue;
      const cat = tool.category || "other";
      const list = map.get(cat) ?? [];
      list.push(tool);
      map.set(cat, list);
    }

    const selectedUnavailable: ToolListItem[] = [];
    for (const toolId of selected) {
      if (visibleToolIds.has(toolId)) continue;
      const existingTool = tools.find((tool) => tool.id === toolId);
      selectedUnavailable.push(existingTool
        ? { ...existingTool, unavailable: true }
        : {
            id: toolId,
            displayName: toolId,
            description: t("tools.selector.unavailableSelectedHint"),
            category: "__unavailable__",
            source: "entitled",
            unavailable: true,
          });
    }
    if (selectedUnavailable.length > 0) {
      map.set("__unavailable__", selectedUnavailable);
    }

    return map;
  }, [tools, allowedSet, selected, visibleToolIds, t]);

  function categoryLabel(category: string): string {
    if (category === "__unavailable__") {
      return t("tools.selector.unavailableSelected");
    }
    return t(`tools.selector.category.${category}`, { defaultValue: category });
  }

  const toolLabel = useToolDisplayLabel();

  function toggleCollapse(category: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  function toggle(toolId: string) {
    const next = new Set(selected);
    if (next.has(toolId)) {
      next.delete(toolId);
    } else {
      next.add(toolId);
    }
    onChange(next);
  }

  function toggleCategory(catTools: AvailableTool[]) {
    const ids = catTools.map((tool) => tool.id);
    const allSelected = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    for (const id of ids) {
      if (allSelected) {
        next.delete(id);
      } else {
        next.add(id);
      }
    }
    onChange(next);
  }

  if (tools.length === 0) {
    return <div className="tool-ms-empty">{t("tools.selector.noTools")}</div>;
  }

  return (
    <div className="tool-ms">
      {Array.from(grouped.entries()).map(([category, catTools]) => {
        const allSelected = catTools.every((tool) => selected.has(tool.id));
        const someSelected = !allSelected && catTools.some((tool) => selected.has(tool.id));
        const isCollapsed = collapsed.has(category);
        return (
          <div key={category} className="tool-ms-group">
            <div className="tool-ms-group-header">
              <input
                type="checkbox"
                className="tool-ms-checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={() => toggleCategory(catTools)}
              />
              <span
                className="tool-ms-group-name"
                onClick={() => toggleCollapse(category)}
              >
                <span className={`tool-ms-chevron${isCollapsed ? "" : " tool-ms-chevron-open"}`}>&#9656;</span>
                {categoryLabel(category)}
              </span>
              <span className="tool-ms-group-count">{catTools.filter((tool) => selected.has(tool.id)).length}/{catTools.length}</span>
            </div>
            {!isCollapsed && (
              <div className="tool-ms-items">
                {catTools.map((tool) => (
                  <label
                    key={tool.id}
                    className={`tool-ms-item${tool.unavailable ? " tool-ms-item-unavailable" : ""}`}
                    title={tool.description}
                  >
                    <input
                      type="checkbox"
                      className="tool-ms-checkbox"
                      checked={selected.has(tool.id)}
                      onChange={() => toggle(tool.id)}
                    />
                    <span className={`tool-ms-item-name${tool.unavailable ? " tool-ms-item-name-unavailable" : ""}`}>
                      {toolLabel(tool.id)}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

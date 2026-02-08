import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchPermissions,
  updatePermissions,
  openFileDialog,
  fetchWorkspacePath,
  type Permissions,
} from "../api.js";

type PermLevel = "read" | "readwrite";

interface PathEntry {
  path: string;
  permission: PermLevel;
}


const switcherBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: "8px 16px",
  border: "1px solid #ccc",
  backgroundColor: active ? "#1a73e8" : "transparent",
  color: active ? "#fff" : "#555",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: active ? 500 : 400,
});

/**
 * Merge readPaths/writePaths into a unified PathEntry list.
 * - path in readPaths only → "read"
 * - path in writePaths (and implicitly readPaths) → "readwrite"
 */
function mergePermissions(perms: Permissions): PathEntry[] {
  const writeSet = new Set(perms.writePaths);
  const allPaths = new Set([...perms.readPaths, ...perms.writePaths]);
  const entries: PathEntry[] = [];
  for (const p of allPaths) {
    entries.push({ path: p, permission: writeSet.has(p) ? "readwrite" : "read" });
  }
  return entries;
}

/**
 * Split PathEntry list back into readPaths/writePaths.
 * - "read" → readPaths only
 * - "readwrite" → both readPaths and writePaths
 */
function splitPermissions(entries: PathEntry[]): Permissions {
  const readPaths: string[] = [];
  const writePaths: string[] = [];
  for (const e of entries) {
    readPaths.push(e.path);
    if (e.permission === "readwrite") {
      writePaths.push(e.path);
    }
  }
  return { readPaths, writePaths };
}

function PermissionSwitcher({
  value,
  onChange,
  t,
  disabled,
}: {
  value: PermLevel;
  onChange: (v: PermLevel) => void;
  t: (key: string) => string;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "inline-flex", borderRadius: 4, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => onChange("read")}
        disabled={disabled}
        style={{
          ...switcherBtnStyle(value === "read"),
          borderRadius: "4px 0 0 4px",
          borderRight: "none",
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {t("permissions.readOnly")}
      </button>
      <button
        type="button"
        onClick={() => onChange("readwrite")}
        disabled={disabled}
        style={{
          ...switcherBtnStyle(value === "readwrite"),
          borderRadius: "0 4px 4px 0",
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {t("permissions.readWrite")}
      </button>
    </div>
  );
}

export function PermissionsPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<PathEntry[]>([]);
  const [error, setError] = useState<{ key: string; detail?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [selectedPerm, setSelectedPerm] = useState<PermLevel>("read");
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    loadPermissions();
    loadWorkspacePath();
  }, []);

  async function loadWorkspacePath() {
    try {
      const path = await fetchWorkspacePath();
      setWorkspacePath(path);
    } catch (err) {
      console.error("Failed to load workspace path:", err);
    }
  }

  async function loadPermissions() {
    try {
      const perms = await fetchPermissions();
      setEntries(mergePermissions(perms));
      setError(null);
    } catch (err) {
      setError({ key: "permissions.failedToLoad", detail: String(err) });
    }
  }

  // Auto-save function - called after any change
  const autoSave = useCallback(async (newEntries: PathEntry[]) => {
    setError(null);
    setSaving(true);
    try {
      await updatePermissions(splitPermissions(newEntries));
      // Success - no need to show anything (changes are auto-saved)
    } catch (err) {
      setError({ key: "permissions.failedToSave", detail: String(err) });
    } finally {
      setSaving(false);
    }
  }, []);

  async function handleBrowse() {
    setError(null);
    try {
      const path = await openFileDialog();
      if (!path) return;

      // Duplicate check
      if (entries.some((e) => e.path === path)) {
        setError({ key: "permissions.duplicatePath" });
        return;
      }

      setSelectedPath(path);
    } catch (err) {
      setError({ key: "permissions.failedToOpenDialog", detail: String(err) });
    }
  }

  async function handleAdd() {
    if (!selectedPath) return;

    setError(null);

    const newEntries = [...entries, { path: selectedPath, permission: selectedPerm }];
    setEntries(newEntries);
    setSelectedPath("");
    setSelectedPerm("read");

    // Auto-save after adding
    await autoSave(newEntries);
  }

  async function handleTogglePermission(index: number, perm: PermLevel) {
    const newEntries = entries.map((e, i) => (i === index ? { ...e, permission: perm } : e));
    setEntries(newEntries);
    // Auto-save after permission change
    await autoSave(newEntries);
  }

  async function handleRemove(index: number) {
    const newEntries = entries.filter((_, i) => i !== index);
    setEntries(newEntries);
    // Auto-save after removal
    await autoSave(newEntries);
  }

  return (
    <div>
      <h1>{t("permissions.title")}</h1>
      <p>{t("permissions.description")}</p>

      {error && (
        <div className="error-alert">
          {t(error.key)}
          {error.detail ?? ""}
        </div>
      )}

      {saving && (
        <div style={{ color: "#1a73e8", marginBottom: 16, fontSize: 13 }}>
          ⟳ {t("common.saving") || "Saving..."}
        </div>
      )}

      <div className="section-card">
        {/* Add path area */}
        <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
          {selectedPath && (
            <code
              style={{
                backgroundColor: "#f1f3f4",
                padding: "8px 12px",
                borderRadius: 4,
                fontSize: 13,
                maxWidth: 400,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                border: "1px solid #e0e0e0",
              }}
            >
              {selectedPath}
            </code>
          )}
          <button
            className="btn btn-outline"
            onClick={handleBrowse}
            disabled={saving}
            style={{ padding: "8px 16px", fontSize: 13, whiteSpace: "nowrap" }}
          >
            {t("permissions.browsePath")}
          </button>
          <PermissionSwitcher
            value={selectedPerm}
            onChange={setSelectedPerm}
            t={t}
            disabled={saving || !selectedPath}
          />
          <button
            className="btn btn-primary"
            onClick={handleAdd}
            disabled={saving || !selectedPath}
            style={{ padding: "8px 16px", fontSize: 13, whiteSpace: "nowrap" }}
          >
            {t("common.add")}
          </button>
        </div>

        {/* Permissions table */}
        <table>
          <thead>
            <tr>
              <th>{t("permissions.colPath")}</th>
              <th>{t("permissions.colPermission")}</th>
              <th style={{ width: 80 }}>{t("permissions.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {/* Workspace row - always shown first, non-editable */}
            {workspacePath && (
              <tr style={{ backgroundColor: "#f8f9fa" }}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{ backgroundColor: "#e8f0fe", padding: "1px 5px", borderRadius: 3, fontSize: 13 }}>
                      {workspacePath}
                    </code>
                    <span style={{ fontSize: 11, color: "#5f6368", fontStyle: "italic" }}>
                      (Workspace)
                    </span>
                    <span
                      style={{ position: "relative", display: "inline-block" }}
                      onMouseEnter={() => setShowTooltip(true)}
                      onMouseLeave={() => setShowTooltip(false)}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          backgroundColor: "#1a73e8",
                          color: "#fff",
                          fontSize: 10,
                          lineHeight: "14px",
                          textAlign: "center",
                          cursor: "help",
                          fontWeight: "bold",
                          fontFamily: "monospace",
                        }}
                      >
                        i
                      </span>
                      {showTooltip && (
                        <span
                          style={{
                            position: "absolute",
                            bottom: "100%",
                            left: "50%",
                            transform: "translateX(-50%)",
                            marginBottom: 8,
                            padding: "8px 12px",
                            backgroundColor: "#333",
                            color: "#fff",
                            fontSize: 12,
                            lineHeight: "1.4",
                            borderRadius: 6,
                            whiteSpace: "nowrap",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                            zIndex: 1000,
                            pointerEvents: "none",
                          }}
                        >
                          {t("permissions.workspaceTooltip")}
                          <span
                            style={{
                              position: "absolute",
                              top: "100%",
                              left: "50%",
                              transform: "translateX(-50%)",
                              width: 0,
                              height: 0,
                              borderLeft: "6px solid transparent",
                              borderRight: "6px solid transparent",
                              borderTop: "6px solid #333",
                            }}
                          />
                        </span>
                      )}
                    </span>
                  </div>
                </td>
                <td>
                  <PermissionSwitcher value="readwrite" onChange={() => {}} t={t} disabled={true} />
                </td>
                <td>
                  <span style={{ fontSize: 11, color: "#888" }}>—</span>
                </td>
              </tr>
            )}

            {/* User-configured paths */}
            {entries.length === 0 && !workspacePath ? (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", color: "#888", padding: "24px 14px" }}>
                  {t("permissions.noPaths")}
                </td>
              </tr>
            ) : (
              entries.map((entry, i) => (
                <tr key={entry.path} className="table-hover-row">
                  <td>
                    <code style={{ backgroundColor: "#f1f3f4", padding: "1px 5px", borderRadius: 3, fontSize: 13 }}>
                      {entry.path}
                    </code>
                  </td>
                  <td>
                    <PermissionSwitcher
                      value={entry.permission}
                      onChange={(perm) => handleTogglePermission(i, perm)}
                      t={t}
                      disabled={saving}
                    />
                  </td>
                  <td>
                    <button
                      className="btn btn-danger"
                      onClick={() => handleRemove(i)}
                      disabled={saving}
                    >
                      {t("common.remove")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

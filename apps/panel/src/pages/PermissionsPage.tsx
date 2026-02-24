import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchPermissions,
  updatePermissions,
  openFileDialog,
  fetchWorkspacePath,
  fetchSettings,
  updateSettings,
  type Permissions,
} from "../api/index.js";

type PermLevel = "read" | "readwrite";

interface PathEntry {
  path: string;
  permission: PermLevel;
}


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
    <div className="perm-switcher">
      <button
        type="button"
        onClick={() => onChange("read")}
        disabled={disabled}
        className={`perm-switcher-btn perm-switcher-btn-left ${value === "read" ? "perm-switcher-btn-active" : "perm-switcher-btn-inactive"}`}
      >
        {t("permissions.readOnly")}
      </button>
      <button
        type="button"
        onClick={() => onChange("readwrite")}
        disabled={disabled}
        className={`perm-switcher-btn perm-switcher-btn-right ${value === "readwrite" ? "perm-switcher-btn-active" : "perm-switcher-btn-inactive"}`}
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
  const [fullAccess, setFullAccess] = useState(true);

  useEffect(() => {
    loadPermissions();
    loadWorkspacePath();
    loadFullAccess();
  }, []);

  async function loadFullAccess() {
    try {
      const settings = await fetchSettings();
      setFullAccess(settings["file-permissions-full-access"] !== "false");
    } catch (err) {
      console.error("Failed to load full-access setting:", err);
    }
  }

  async function handleToggleFullAccess(enabled: boolean) {
    setFullAccess(enabled);
    setSaving(true);
    try {
      await updateSettings({ "file-permissions-full-access": enabled ? "true" : "false" });
    } catch (err) {
      setError({ key: "permissions.failedToSave", detail: String(err) });
      setFullAccess(!enabled); // revert on failure
    } finally {
      setSaving(false);
    }
  }

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
        <div className="text-sm text-secondary mb-md">
          ⟳ {t("common.saving") || "Saving..."}
        </div>
      )}

      {/* Full Access Toggle */}
      <div className="section-card mb-md">
        <div className="perm-full-access-row">
          <div>
            <strong>{t("permissions.fullAccessLabel")}</strong>
            <p className="text-sm text-secondary" style={{ margin: "4px 0 0" }}>
              {t("permissions.fullAccessDescription")}
            </p>
          </div>
          <label className="toggle-switch" style={{ marginLeft: 16 }}>
            <input
              type="checkbox"
              checked={fullAccess}
              onChange={(e) => handleToggleFullAccess(e.target.checked)}
              disabled={saving}
            />
            <span
              className={`toggle-track ${fullAccess ? "toggle-track-on" : "toggle-track-off"} ${saving ? "toggle-track-disabled" : ""}`}
            >
              <span
                className={`toggle-thumb ${fullAccess ? "toggle-thumb-on" : "toggle-thumb-off"}`}
              />
            </span>
          </label>
        </div>
      </div>

      <div className="section-card" style={{ opacity: fullAccess ? 0.5 : 1, pointerEvents: fullAccess ? "none" : "auto" }}>
        {/* Add path area */}
        <div className="perm-add-path-row">
          {selectedPath && (
            <code className="perm-path-display">
              {selectedPath}
            </code>
          )}
          <button
            className="btn btn-outline btn-sm"
            onClick={handleBrowse}
            disabled={saving}
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
            className="btn btn-primary btn-sm"
            onClick={handleAdd}
            disabled={saving || !selectedPath}
          >
            {t("common.add")}
          </button>
        </div>

        {/* Permissions table */}
        <div className="table-scroll-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("permissions.colPath")}</th>
              <th>{t("permissions.colPermission")}</th>
              <th className="td-actions">{t("permissions.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {/* Workspace row - always shown first, non-editable */}
            {workspacePath && (
              <tr className="perm-workspace-row">
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code className="perm-path-display">
                      {workspacePath}
                    </code>
                    <span className="perm-workspace-label">
                      (Workspace)
                    </span>
                    <span
                      className="has-tooltip"
                      data-tooltip={t("permissions.workspaceTooltip")}
                    >
                      i
                    </span>
                  </div>
                </td>
                <td>
                  <PermissionSwitcher value="readwrite" onChange={() => {}} t={t} disabled={true} />
                </td>
                <td>
                  <span className="text-muted text-xs">&mdash;</span>
                </td>
              </tr>
            )}

            {/* User-configured paths */}
            {entries.length === 0 && !workspacePath ? (
              <tr>
                <td colSpan={3} className="empty-cell">
                  {t("permissions.noPaths")}
                </td>
              </tr>
            ) : (
              entries.map((entry, i) => (
                <tr key={entry.path} className="table-hover-row">
                  <td>
                    <code className="perm-path-display">
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
    </div>
  );
}

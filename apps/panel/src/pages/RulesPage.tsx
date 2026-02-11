import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fetchRules, createRule, updateRule, deleteRule, trackEvent, type Rule } from "../api.js";

const EXAMPLE_RULE_KEYS = [
  "onboarding.exampleRule1",
  "onboarding.exampleRule2",
  "onboarding.exampleRule3",
  "onboarding.exampleRule4",
  "onboarding.exampleRule5",
];


function StatusBadge({ status }: { status?: Rule["artifactStatus"] }) {
  const { t } = useTranslation();

  const styles: Record<string, { background: string; color: string; label: string }> = {
    ok: { background: "#e6f4ea", color: "#1e7e34", label: t("rules.compiled") },
    failed: { background: "#fce8e6", color: "#c5221f", label: t("rules.failed") },
    pending: { background: "#fef7e0", color: "#b06000", label: t("rules.pending") },
  };

  const info = status ? styles[status] : undefined;
  const background = info?.background ?? "#f1f3f4";
  const color = info?.color ?? "#5f6368";
  const label = info?.label ?? t("rules.notCompiled");

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 500,
        background,
        color,
      }}
    >
      {label}
    </span>
  );
}

export function RulesPage() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<Rule[]>([]);
  const [newRuleText, setNewRuleText] = useState("");
  const [error, setError] = useState<{ key: string; detail?: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    loadRules();
  }, []);

  // Poll while any rule has "pending" status so the UI updates when compilation finishes
  const hasPending = rules.some((r) => r.artifactStatus === "pending");
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(loadRules, 3000);
    return () => clearInterval(timer);
  }, [hasPending]);

  async function loadRules() {
    try {
      setRules(await fetchRules());
      setError(null);
    } catch (err) {
      setError({ key: "rules.failedToLoad", detail: String(err) });
    }
  }

  async function handleCreate() {
    if (!newRuleText.trim()) return;
    try {
      await createRule(newRuleText.trim());
      setNewRuleText("");
      await loadRules();
    } catch (err) {
      setError({ key: "rules.failedToCreate", detail: String(err) });
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteRule(id);
      await loadRules();
    } catch (err) {
      setError({ key: "rules.failedToDelete", detail: String(err) });
    }
  }

  function handleStartEdit(rule: Rule) {
    setEditingId(rule.id);
    setEditText(rule.text);
  }

  async function handleSaveEdit(id: string) {
    if (!editText.trim()) return;
    try {
      await updateRule(id, editText.trim());
      setEditingId(null);
      setEditText("");
      await loadRules();
    } catch (err) {
      setError({ key: "rules.failedToUpdate", detail: String(err) });
    }
  }

  function handleCancelEdit() {
    setEditingId(null);
    setEditText("");
  }

  async function handleRecompile(rule: Rule) {
    try {
      await updateRule(rule.id, rule.text);
      await loadRules();
    } catch (err) {
      setError({ key: "rules.failedToRecompile", detail: String(err) });
    }
  }

  return (
    <div>
      <h1>{t("rules.title")}</h1>
      <p>{t("rules.description")}</p>

      {error && (
        <div className="error-alert">{t(error.key)}{error.detail ?? ""}</div>
      )}

      {/* Add Rule — examples left, input right */}
      <div className="section-card">
        <h3>{t("rules.addRule")}</h3>
        <div style={{ display: "flex", gap: 24, marginBottom: 12 }}>
          {/* Left: label */}
          <div style={{ flex: "0 0 40%", fontSize: 12, color: "#888" }}>
            {t("onboarding.tryExample")}
          </div>
          <div style={{ flex: 1 }} />
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "stretch" }}>
          {/* Left: examples */}
          <div style={{ flex: "0 0 40%", display: "flex", flexDirection: "column", gap: 8 }}>
            {EXAMPLE_RULE_KEYS.map((ruleKey, index) => {
              const text = t(ruleKey);
              return (
                <button
                  key={ruleKey}
                  onClick={() => {
                    setNewRuleText(text);
                    trackEvent("rule.preset_used", { presetIndex: index });
                  }}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 6,
                    border: "1px solid",
                    backgroundColor: newRuleText === text ? "#e8f0fe" : "#fafafa",
                    borderColor: newRuleText === text ? "#1a73e8" : "#e0e0e0",
                    fontSize: 13,
                    cursor: "pointer",
                    color: "#333",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                    lineHeight: 1.5,
                  }}
                  onMouseEnter={(e) => {
                    if (newRuleText !== text) {
                      e.currentTarget.style.backgroundColor = "#f0f0f0";
                      e.currentTarget.style.borderColor = "#1a73e8";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (newRuleText !== text) {
                      e.currentTarget.style.backgroundColor = "#fafafa";
                      e.currentTarget.style.borderColor = "#e0e0e0";
                    }
                  }}
                >
                  {text}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div style={{ width: 1, backgroundColor: "#e2e5e9", flexShrink: 0 }} />

          {/* Right: text input */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <textarea
              value={newRuleText}
              onChange={(e) => setNewRuleText(e.target.value)}
              placeholder={t("rules.placeholder")}
              rows={8}
              style={{ width: "100%", flex: 1, display: "block", resize: "vertical", minHeight: 160 }}
            />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={!newRuleText.trim()}
            style={{ padding: "8px 24px", fontSize: 13 }}
          >
            {t("rules.addRule")}
          </button>
        </div>
      </div>

      <div className="section-card">
        <h3>{t("rules.colRule")}</h3>
        <table>
          <thead>
            <tr>
              <th style={{ width: "45%" }}>{t("rules.colRule")}</th>
              <th>{t("rules.colStatus")}</th>
              <th>{t("rules.colType")}</th>
              <th>{t("rules.colCreated")}</th>
              <th>{t("rules.colActions")}</th>
            </tr>
          </thead>
        <tbody>
          {rules.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ textAlign: "center", color: "#888", padding: "24px 14px" }}>
                {t("rules.emptyState")}
              </td>
            </tr>
          ) : (
            rules.map((rule) => (
              <tr key={rule.id} className="table-hover-row">
                <td>
                  {editingId === rule.id ? (
                    <div>
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                        style={{ width: "100%", marginBottom: 6, display: "block", fontSize: 13 }}
                      />
                      <button className="btn btn-primary" onClick={() => handleSaveEdit(rule.id)} style={{ marginRight: 6 }}>
                        {t("common.save")}
                      </button>
                      <button className="btn btn-secondary" onClick={handleCancelEdit}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  ) : (
                    <span title={rule.text}>
                      {rule.text.length > 80 ? rule.text.slice(0, 80) + "..." : rule.text}
                    </span>
                  )}
                </td>
                <td>
                  <StatusBadge status={rule.artifactStatus} />
                </td>
                <td>
                  {rule.artifactType ?? "—"}
                </td>
                <td style={{ fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>
                  {new Date(rule.createdAt).toLocaleDateString()}
                </td>
                <td>
                  {editingId !== rule.id && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleStartEdit(rule)}
                      >
                        {t("common.edit")}
                      </button>
                      <button
                        className="btn btn-outline"
                        onClick={() => handleRecompile(rule)}
                      >
                        {t("rules.recompile")}
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDelete(rule.id)}
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  )}
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

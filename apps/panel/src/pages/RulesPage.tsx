import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { fetchRules, createRule, updateRule, deleteRule, trackEvent, type Rule } from "../api/index.js";

const EXAMPLE_RULE_KEYS = [
  "onboarding.exampleRule1",
  "onboarding.exampleRule2",
  "onboarding.exampleRule3",
  "onboarding.exampleRule4",
  "onboarding.exampleRule5",
];


function StatusBadge({ status }: { status?: Rule["artifactStatus"] }) {
  const { t } = useTranslation();

  const variants: Record<string, { className: string; label: string }> = {
    ok: { className: "badge-success", label: t("rules.compiled") },
    failed: { className: "badge-danger", label: t("rules.failed") },
    pending: { className: "badge-warning", label: t("rules.pending") },
  };

  const info = status ? variants[status] : undefined;
  const badgeClass = info?.className ?? "badge-default";
  const label = info?.label ?? t("rules.notCompiled");

  return (
    <span className={`badge ${badgeClass}`}>
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
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showTooltip = useCallback((e: React.MouseEvent, text: string) => {
    clearTimeout(tooltipTimer.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ text, x: rect.left, y: rect.bottom + 4 });
  }, []);

  const hideTooltip = useCallback(() => {
    tooltipTimer.current = setTimeout(() => setTooltip(null), 100);
  }, []);

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
        <div className="rules-create-section mb-sm">
          {/* Left: label */}
          <div className="rules-label-col text-muted text-sm">
            {t("onboarding.tryExample")}
          </div>
          <div style={{ flex: 1 }} />
        </div>
        <div className="rules-examples-row">
          {/* Left: examples */}
          <div className="rules-examples-col">
            {EXAMPLE_RULE_KEYS.map((ruleKey, index) => {
              const text = t(ruleKey);
              return (
                <button
                  key={ruleKey}
                  className={"rule-example-btn " + (newRuleText === text ? "rule-example-selected" : "rule-example-unselected")}
                  onClick={() => {
                    setNewRuleText(text);
                    trackEvent("rule.preset_used", { presetIndex: index });
                  }}
                >
                  {text}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="rules-divider" />

          {/* Right: text input */}
          <div className="rules-editor-col">
            <textarea
              className="input-full rules-editor-textarea"
              value={newRuleText}
              onChange={(e) => setNewRuleText(e.target.value)}
              placeholder={t("rules.placeholder")}
            />
          </div>
        </div>
        <div className="form-actions">
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={!newRuleText.trim()}
          >
            {t("rules.addRule")}
          </button>
        </div>
      </div>

      <div className="section-card">
        <h3>{t("rules.colRule")}</h3>
        <div className="table-scroll-wrap">
        <table className="rules-table">
          <thead>
            <tr>
              <th>{t("rules.colRule")}</th>
              <th className="rules-col-status">{t("rules.colStatus")}</th>
              <th className="rules-col-type">{t("rules.colType")}</th>
              <th className="rules-col-date">{t("rules.colCreated")}</th>
              <th className="rules-col-actions">{t("rules.colActions")}</th>
            </tr>
          </thead>
        <tbody>
          {rules.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty-cell">
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
                        className="input-full mb-sm"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                      />
                      <div className="td-edit-actions">
                        <button className="btn btn-primary btn-sm" onClick={() => handleSaveEdit(rule.id)}>
                          {t("common.save")}
                        </button>
                        <button className="btn btn-secondary" onClick={handleCancelEdit}>
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span
                      className="td-rule-text"
                      onMouseEnter={(e) => showTooltip(e, rule.text)}
                      onMouseLeave={hideTooltip}
                    >
                      {rule.text}
                    </span>
                  )}
                </td>
                <td>
                  <StatusBadge status={rule.artifactStatus} />
                </td>
                <td>
                  {rule.artifactType ?? "—"}
                </td>
                <td className="td-date">
                  {new Date(rule.createdAt).toLocaleDateString()}
                </td>
                <td className="td-actions">
                  {editingId !== rule.id && (
                    <div className="td-actions">
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

      {tooltip && (
        <div
          className="td-rule-tooltip-fixed"
          onMouseEnter={() => clearTimeout(tooltipTimer.current)}
          onMouseLeave={hideTooltip}
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

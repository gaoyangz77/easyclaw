import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "../components/Select.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useCronManager } from "./crons/useCronManager.js";
import { CronJobForm } from "./crons/CronJobForm.js";
import { CronRunHistory } from "./crons/CronRunHistory.js";
import type { CronJob, CronListParams } from "./crons/cron-utils.js";
import { formatSchedule, formatRelativeTime, getTzI18nKey } from "./crons/cron-utils.js";
import "./CronsPage.css";

const ENABLED_OPTIONS = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

const SORT_OPTIONS = [
  { value: "nextRunAtMs", label: "NextRun" },
  { value: "updatedAtMs", label: "Updated" },
  { value: "name", label: "Name" },
];

export function CronsPage() {
  const { t } = useTranslation();
  const cron = useCronManager();
  const now = Date.now();

  // Toolbar state
  const [searchQuery, setSearchQuery] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("all");
  const [sortBy, setSortBy] = useState("nextRunAtMs");

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [historyJobId, setHistoryJobId] = useState<string | null>(null);
  const [historyJobName, setHistoryJobName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    const params: CronListParams = { query: query || undefined };
    cron.fetchJobs(params);
  }, [cron]);

  const handleFilterChange = useCallback((value: string) => {
    setEnabledFilter(value);
    cron.fetchJobs({ enabled: value as "all" | "enabled" | "disabled" });
  }, [cron]);

  const handleSortChange = useCallback((value: string) => {
    setSortBy(value);
    cron.fetchJobs({ sortBy: value as CronListParams["sortBy"] });
  }, [cron]);

  const handleToggle = useCallback(async (job: CronJob) => {
    try {
      setActionError(null);
      await cron.toggleEnabled(job.id, !job.enabled);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [cron]);

  const handleRun = useCallback(async (id: string) => {
    try {
      setActionError(null);
      setRunningJobId(id);
      await cron.runJob(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningJobId(null);
    }
  }, [cron]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      setActionError(null);
      await cron.removeJob(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [cron, deleteTarget]);

  const handleFormSubmit = useCallback(async (params: Record<string, unknown>) => {
    await (editingJob
      ? cron.updateJob(editingJob.id, params)
      : cron.addJob(params));
    setFormOpen(false);
    setEditingJob(null);
  }, [cron, editingJob]);

  const openCreate = useCallback(() => {
    setEditingJob(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((job: CronJob) => {
    setEditingJob(job);
    setFormOpen(true);
  }, []);

  const openHistory = useCallback((job: CronJob) => {
    setHistoryJobId(job.id);
    setHistoryJobName(job.name);
  }, []);

  function getStatusBadge(job: CronJob) {
    if (job.state.runningAtMs) {
      return <span className="badge badge-info"><span className="crons-running-indicator" />{t("crons.statusRunning")}</span>;
    }
    const status = job.state.lastRunStatus ?? job.state.lastStatus;
    if (!status) return <span className="badge badge-default">{t("crons.neverRun")}</span>;
    const cls = status === "ok" ? "badge-success" : status === "error" ? "badge-danger" : "badge-warning";
    return <span className={`badge ${cls}`}>{t(`crons.status${status.charAt(0).toUpperCase()}${status.slice(1)}`)}</span>;
  }

  return (
    <div className="page-enter">
      <h1>{t("crons.title")}</h1>
      <p className="page-description">{t("crons.description")}</p>

      <div className="crons-status-bar">
        <span className={`crons-status-dot crons-status-dot-${cron.connectionState}`} />
        <span>{t(`crons.${cron.connectionState}`)}</span>
        {cron.total > 0 && <span className="text-muted">({cron.total} {t("crons.jobCount")})</span>}
      </div>

      {(cron.error || actionError) && (
        <div className="error-alert">
          {cron.error || actionError}
          <div className="error-alert-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => { setActionError(null); cron.fetchJobs(); }}>
              {t("crons.retry")}
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="section-card">
        <div className="crons-toolbar">
          <input
            className="input-full crons-search-input"
            placeholder={t("crons.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
          <Select
            className="crons-filter-select"
            value={enabledFilter}
            onChange={handleFilterChange}
            options={ENABLED_OPTIONS.map(o => ({ ...o, label: t(`crons.filter${o.label}`) }))}
          />
          <Select
            className="crons-filter-select"
            value={sortBy}
            onChange={handleSortChange}
            options={SORT_OPTIONS.map(o => ({ ...o, label: t(`crons.sort${o.label}`) }))}
          />
          <button
            className="btn btn-primary"
            onClick={openCreate}
            disabled={cron.connectionState !== "connected"}
          >
            {t("crons.addJob")}
          </button>
        </div>
      </div>

      {/* Job list */}
      <div className="section-card">
        {cron.loading && cron.jobs.length === 0 ? (
          <div className="loading-state">
            <span className="spinner" />
            <span>{t("common.loading")}</span>
          </div>
        ) : cron.jobs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">{t("crons.emptyState")}</div>
          </div>
        ) : (
          <div className="table-scroll-wrap">
            <table className="crons-table">
              <thead>
                <tr>
                  <th>{t("crons.colName")}</th>
                  <th>{t("crons.colSchedule")}</th>
                  <th>{t("crons.colEnabled")}</th>
                  <th>{t("crons.colLastRun")}</th>
                  <th>{t("crons.colNextRun")}</th>
                  <th>{t("crons.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {cron.jobs.map((job) => (
                  <tr key={job.id} className="table-hover-row">
                    <td>
                      <div className="crons-job-name">{job.name}</div>
                      {job.description && <div className="crons-job-desc" title={job.description}>{job.description}</div>}
                    </td>
                    <td>
                      {job.schedule.kind === "cron" ? (
                        <>
                          <span className="crons-schedule-text">{job.schedule.expr}</span>
                          {job.schedule.tz && (
                            <div className="crons-schedule-tz">
                              {(() => {
                                const key = getTzI18nKey(job.schedule.tz);
                                return key ? t(`crons.${key}`) : job.schedule.tz;
                              })()}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="crons-schedule-text">{formatSchedule(job.schedule)}</span>
                      )}
                    </td>
                    <td>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={job.enabled}
                          onChange={() => handleToggle(job)}
                        />
                        <span className={`toggle-track ${job.enabled ? "toggle-track-on" : "toggle-track-off"}`}>
                          <span className={`toggle-thumb ${job.enabled ? "toggle-thumb-on" : "toggle-thumb-off"}`} />
                        </span>
                      </label>
                    </td>
                    <td>
                      <div className="crons-time-cell">
                        {getStatusBadge(job)}
                        {job.state.lastRunAtMs && (
                          <div className="text-muted" title={new Date(job.state.lastRunAtMs).toLocaleString()}>
                            {formatRelativeTime(job.state.lastRunAtMs, now)}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="crons-time-cell">
                        {job.state.nextRunAtMs
                          ? <span title={new Date(job.state.nextRunAtMs).toLocaleString()}>{formatRelativeTime(job.state.nextRunAtMs, now)}</span>
                          : <span className="text-muted">—</span>
                        }
                      </div>
                    </td>
                    <td className="td-actions">
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(job)}>
                        {t("common.edit")}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleRun(job.id)}
                        disabled={runningJobId === job.id}
                      >
                        {runningJobId === job.id ? "..." : t("crons.runNow")}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => openHistory(job)}>
                        {t("crons.viewHistory")}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget({ id: job.id, name: job.name })}>
                        {t("common.delete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit modal */}
      {formOpen && (
        <CronJobForm
          mode={editingJob ? "edit" : "create"}
          initialData={editingJob ?? undefined}
          onSubmit={handleFormSubmit}
          onCancel={() => { setFormOpen(false); setEditingJob(null); }}
        />
      )}

      {/* Run history modal */}
      {historyJobId && (
        <CronRunHistory
          jobId={historyJobId}
          jobName={historyJobName}
          fetchRuns={cron.fetchRuns}
          onClose={() => setHistoryJobId(null)}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        title={t("crons.confirmDelete")}
        message={t("crons.confirmDeleteMessage", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        confirmVariant="danger"
      />
    </div>
  );
}

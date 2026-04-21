import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent } from "../../api/index.js";
import { setRunProfileForScope } from "../../api/tool-registry.js";
import { Select } from "../../components/inputs/Select.js";
import { ConfirmDialog } from "../../components/modals/ConfirmDialog.js";
import { useCronManager } from "./useCronManager.js";
import { CronJobForm } from "./CronJobForm.js";
import { SUBMIT_RUN_PROFILE_ID_KEY } from "./hooks/useCronForm.js";
import { CronRunHistory } from "./CronRunHistory.js";
import { CronJobTable } from "./components/CronJobTable.js";
import type { CronJob, CronListParams } from "./cron-utils.js";
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
      trackEvent("cron.toggled", { enabled: !job.enabled });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [cron]);

  const handleRun = useCallback(async (id: string) => {
    try {
      setActionError(null);
      setRunningJobId(id);
      // Tool context is now pushed automatically by Desktop when gateway fires session_start
      await cron.runJob(id);
      trackEvent("cron.run_now");
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
      trackEvent("cron.deleted");
      setDeleteTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [cron, deleteTarget]);

  const handleFormSubmit = useCallback(async (params: Record<string, unknown>) => {
    const runProfileIdRaw = params[SUBMIT_RUN_PROFILE_ID_KEY];
    const runProfileId = typeof runProfileIdRaw === "string" ? runProfileIdRaw : null;
    const cronParams = { ...params };
    delete cronParams[SUBMIT_RUN_PROFILE_ID_KEY];

    const isCreate = !editingJob;
    if (editingJob) {
      await cron.updateJob(editingJob.id, cronParams);
      await setRunProfileForScope(editingJob.id, runProfileId);
    } else {
      const newJob = await cron.addJob(cronParams);
      await setRunProfileForScope(newJob.id, runProfileId);
    }
    if (isCreate) trackEvent("cron.created");
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
      <CronJobTable
        jobs={cron.jobs}
        loading={cron.loading}
        now={now}
        runningJobId={runningJobId}
        onEdit={openEdit}
        onToggle={handleToggle}
        onRun={handleRun}
        onHistory={openHistory}
        onDelete={setDeleteTarget}
      />

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

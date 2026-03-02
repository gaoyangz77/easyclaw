// ── Type definitions ──
// Mirror the subset of OpenClaw cron types needed by the panel UI.
// We re-declare them here to avoid importing from vendor/ (which may not
// be available in the panel build).

export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string; staggerMs?: number };

export type CronSessionTarget = "main" | "isolated";
export type CronWakeMode = "next-heartbeat" | "now";
export type CronDeliveryMode = "none" | "announce" | "webhook";

export type CronDelivery = {
  mode: CronDeliveryMode;
  channel?: string;
  to?: string;
  accountId?: string;
  bestEffort?: boolean;
};

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | {
      kind: "agentTurn";
      message: string;
      model?: string;
      thinking?: string;
      timeoutSeconds?: number;
    };

export type CronRunStatus = "ok" | "error" | "skipped";
export type CronDeliveryStatus = "delivered" | "not-delivered" | "unknown" | "not-requested";

export type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: CronRunStatus;
  lastStatus?: CronRunStatus;
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  lastDeliveryStatus?: CronDeliveryStatus;
  lastDeliveryError?: string;
};

export type CronJob = {
  id: string;
  agentId?: string;
  sessionKey?: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  delivery?: CronDelivery;
  state: CronJobState;
};

export type CronRunLogEntry = {
  ts: number;
  jobId: string;
  action: string;
  status?: CronRunStatus;
  error?: string;
  summary?: string;
  delivered?: boolean;
  deliveryStatus?: CronDeliveryStatus;
  deliveryError?: string;
  sessionId?: string;
  sessionKey?: string;
  runAtMs?: number;
  durationMs?: number;
  nextRunAtMs?: number;
  model?: string;
  provider?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  jobName?: string;
};

// ── API response types ──

export type CronListResult = {
  jobs: CronJob[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
};

export type CronListParams = {
  includeDisabled?: boolean;
  limit?: number;
  offset?: number;
  query?: string;
  enabled?: "all" | "enabled" | "disabled";
  sortBy?: "nextRunAtMs" | "updatedAtMs" | "name";
  sortDir?: "asc" | "desc";
};

export type CronRunsResult = {
  entries: CronRunLogEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
};

export type CronStatus = {
  enabled: boolean;
  storePath: string;
  jobs: number;
  nextWakeAtMs: number | null;
};

// ── Form state ──

export type ScheduleKind = "cron" | "every" | "at";
export type PayloadKind = "agentTurn" | "systemEvent";
export type EveryUnit = "seconds" | "minutes" | "hours";

export interface CronJobFormData {
  name: string;
  description: string;
  scheduleKind: ScheduleKind;
  cronExpr: string;
  cronTz: string;
  everyValue: number;
  everyUnit: EveryUnit;
  atDatetime: string;
  payloadKind: PayloadKind;
  message: string;
  text: string;
  model: string;
  thinking: string;
  timeoutSeconds: string;
  deliveryMode: CronDeliveryMode;
  deliveryChannel: string;
  deliveryTo: string;
  enabled: boolean;
  deleteAfterRun: boolean;
  wakeMode: CronWakeMode;
}

export function defaultFormData(): CronJobFormData {
  return {
    name: "",
    description: "",
    scheduleKind: "cron",
    cronExpr: "",
    cronTz: "",
    everyValue: 60,
    everyUnit: "minutes",
    atDatetime: "",
    payloadKind: "agentTurn",
    message: "",
    text: "",
    model: "",
    thinking: "",
    timeoutSeconds: "",
    deliveryMode: "none",
    deliveryChannel: "",
    deliveryTo: "",
    enabled: true,
    deleteAfterRun: false,
    wakeMode: "now",
  };
}

// ── Conversions ──

export function cronJobToFormData(job: CronJob): CronJobFormData {
  const form = defaultFormData();
  form.name = job.name;
  form.description = job.description ?? "";
  form.enabled = job.enabled;
  form.deleteAfterRun = job.deleteAfterRun ?? false;
  form.wakeMode = job.wakeMode;

  // Schedule
  if (job.schedule.kind === "cron") {
    form.scheduleKind = "cron";
    form.cronExpr = job.schedule.expr;
    form.cronTz = job.schedule.tz ?? "";
  } else if (job.schedule.kind === "every") {
    form.scheduleKind = "every";
    const ms = job.schedule.everyMs;
    if (ms >= 3600000 && ms % 3600000 === 0) {
      form.everyValue = ms / 3600000;
      form.everyUnit = "hours";
    } else if (ms >= 60000 && ms % 60000 === 0) {
      form.everyValue = ms / 60000;
      form.everyUnit = "minutes";
    } else {
      form.everyValue = ms / 1000;
      form.everyUnit = "seconds";
    }
  } else {
    form.scheduleKind = "at";
    form.atDatetime = isoToDatetimeLocal(job.schedule.at);
  }

  // Payload
  if (job.payload.kind === "agentTurn") {
    form.payloadKind = "agentTurn";
    form.message = job.payload.message;
    form.model = job.payload.model ?? "";
    form.thinking = job.payload.thinking ?? "";
    form.timeoutSeconds = job.payload.timeoutSeconds != null ? String(job.payload.timeoutSeconds) : "";
  } else {
    form.payloadKind = "systemEvent";
    form.text = job.payload.text;
  }

  // Delivery
  if (job.delivery) {
    form.deliveryMode = job.delivery.mode;
    form.deliveryChannel = job.delivery.channel ?? "";
    form.deliveryTo = job.delivery.to ?? "";
  }

  return form;
}

export function formDataToCreateParams(data: CronJobFormData): Record<string, unknown> {
  const schedule = buildSchedule(data);
  const payload = buildPayload(data);
  const sessionTarget: CronSessionTarget = data.payloadKind === "systemEvent" ? "main" : "isolated";

  const params: Record<string, unknown> = {
    name: data.name.trim(),
    schedule,
    sessionTarget,
    wakeMode: data.wakeMode,
    payload,
    enabled: data.enabled,
  };
  if (data.description.trim()) params.description = data.description.trim();
  if (data.deleteAfterRun) params.deleteAfterRun = true;
  if (data.payloadKind === "agentTurn" && data.deliveryMode !== "none") {
    params.delivery = buildDelivery(data);
  }
  return params;
}

export function formDataToPatch(original: CronJob, data: CronJobFormData): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (data.name.trim() !== original.name) patch.name = data.name.trim();
  if ((data.description.trim() || "") !== (original.description ?? "")) patch.description = data.description.trim();
  if (data.enabled !== original.enabled) patch.enabled = data.enabled;
  if ((data.deleteAfterRun ?? false) !== (original.deleteAfterRun ?? false)) patch.deleteAfterRun = data.deleteAfterRun;
  if (data.wakeMode !== original.wakeMode) patch.wakeMode = data.wakeMode;

  const sessionTarget: CronSessionTarget = data.payloadKind === "systemEvent" ? "main" : "isolated";
  if (sessionTarget !== original.sessionTarget) patch.sessionTarget = sessionTarget;

  // Always send schedule and payload in patch to simplify diffing
  patch.schedule = buildSchedule(data);
  patch.payload = buildPayload(data);

  if (data.payloadKind === "agentTurn" && data.deliveryMode !== "none") {
    patch.delivery = buildDelivery(data);
  } else if (original.delivery && original.delivery.mode !== "none") {
    patch.delivery = { mode: "none" };
  }

  return patch;
}

function buildSchedule(data: CronJobFormData): CronSchedule {
  if (data.scheduleKind === "cron") {
    const s: CronSchedule = { kind: "cron", expr: data.cronExpr.trim() };
    if (data.cronTz.trim()) (s as { tz?: string }).tz = data.cronTz.trim();
    return s;
  }
  if (data.scheduleKind === "every") {
    const multiplier = data.everyUnit === "hours" ? 3600000 : data.everyUnit === "minutes" ? 60000 : 1000;
    return { kind: "every", everyMs: data.everyValue * multiplier };
  }
  return { kind: "at", at: datetimeLocalToIso(data.atDatetime) };
}

function buildPayload(data: CronJobFormData): CronPayload {
  if (data.payloadKind === "systemEvent") {
    return { kind: "systemEvent", text: data.text.trim() };
  }
  const p: CronPayload & { kind: "agentTurn" } = { kind: "agentTurn", message: data.message.trim() };
  if (data.model.trim()) p.model = data.model.trim();
  if (data.thinking.trim()) p.thinking = data.thinking.trim();
  if (data.timeoutSeconds.trim()) p.timeoutSeconds = Number(data.timeoutSeconds);
  return p;
}

function buildDelivery(data: CronJobFormData): CronDelivery {
  const d: CronDelivery = { mode: data.deliveryMode };
  if (data.deliveryChannel.trim()) d.channel = data.deliveryChannel.trim();
  if (data.deliveryTo.trim()) d.to = data.deliveryTo.trim();
  return d;
}

// ── Timezone entries (shared between form and list) ──

export const TIMEZONE_ENTRIES: { value: string; i18nKey: string }[] = [
  { value: "", i18nKey: "tzLocal" },
  { value: "Asia/Shanghai", i18nKey: "tzAsiaShanghai" },
  { value: "Asia/Tokyo", i18nKey: "tzAsiaTokyo" },
  { value: "Asia/Seoul", i18nKey: "tzAsiaSeoul" },
  { value: "Asia/Singapore", i18nKey: "tzAsiaSingapore" },
  { value: "Asia/Kolkata", i18nKey: "tzAsiaKolkata" },
  { value: "Asia/Dubai", i18nKey: "tzAsiaDubai" },
  { value: "America/New_York", i18nKey: "tzAmericaNewYork" },
  { value: "America/Chicago", i18nKey: "tzAmericaChicago" },
  { value: "America/Denver", i18nKey: "tzAmericaDenver" },
  { value: "America/Los_Angeles", i18nKey: "tzAmericaLosAngeles" },
  { value: "America/Sao_Paulo", i18nKey: "tzAmericaSaoPaulo" },
  { value: "Europe/London", i18nKey: "tzEuropeLondon" },
  { value: "Europe/Berlin", i18nKey: "tzEuropeBerlin" },
  { value: "Europe/Moscow", i18nKey: "tzEuropeMoscow" },
  { value: "Australia/Sydney", i18nKey: "tzAustraliaSydney" },
  { value: "Pacific/Auckland", i18nKey: "tzPacificAuckland" },
  { value: "UTC", i18nKey: "tzUTC" },
];

const TZ_I18N_MAP = new Map(TIMEZONE_ENTRIES.map((e) => [e.value, e.i18nKey]));

/** Return the crons.tz* i18n key for a timezone value, or null if not in our list. */
export function getTzI18nKey(tz: string): string | null {
  return TZ_I18N_MAP.get(tz) ?? null;
}

// ── Formatting ──

export function formatSchedule(schedule: CronSchedule): string {
  if (schedule.kind === "cron") {
    const tz = schedule.tz ? ` (${schedule.tz})` : "";
    return `${schedule.expr}${tz}`;
  }
  if (schedule.kind === "every") {
    const ms = schedule.everyMs;
    if (ms >= 3600000 && ms % 3600000 === 0) return `Every ${ms / 3600000}h`;
    if (ms >= 60000 && ms % 60000 === 0) return `Every ${ms / 60000}m`;
    return `Every ${ms / 1000}s`;
  }
  // "at"
  try {
    return new Date(schedule.at).toLocaleString();
  } catch {
    return schedule.at;
  }
}

export function formatRelativeTime(targetMs: number, nowMs: number): string {
  const diffMs = targetMs - nowMs;
  const absDiff = Math.abs(diffMs);
  const isFuture = diffMs > 0;

  if (absDiff < 60000) {
    const s = Math.round(absDiff / 1000);
    return isFuture ? `in ${s}s` : `${s}s ago`;
  }
  if (absDiff < 3600000) {
    const m = Math.round(absDiff / 60000);
    return isFuture ? `in ${m}m` : `${m}m ago`;
  }
  if (absDiff < 86400000) {
    const h = Math.round(absDiff / 3600000);
    return isFuture ? `in ${h}h` : `${h}h ago`;
  }
  const d = Math.round(absDiff / 86400000);
  return isFuture ? `in ${d}d` : `${d}d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ── Validation ──

export type FormErrors = Record<string, string>;

/** Validate a single cron field (minute/hour/dom/month/dow) against its allowed range. */
function isValidCronField(field: string, min: number, max: number): boolean {
  // Handle list: "1,5,10"
  for (const part of field.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) return false;
    // Wildcard
    if (trimmed === "*") continue;
    // Step: */2, 1-5/2, or */3
    const stepMatch = trimmed.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const step = Number(stepMatch[2]);
      if (step <= 0) return false;
      const base = stepMatch[1];
      if (base === "*") continue;
      // Range with step: 1-5/2
      const rangeMatch = base.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const lo = Number(rangeMatch[1]);
        const hi = Number(rangeMatch[2]);
        if (lo < min || hi > max || lo > hi) return false;
        continue;
      }
      return false;
    }
    // Range: 1-5
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const lo = Number(rangeMatch[1]);
      const hi = Number(rangeMatch[2]);
      if (lo < min || hi > max || lo > hi) return false;
      continue;
    }
    // Single number
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (n < min || n > max) return false;
      continue;
    }
    return false;
  }
  return true;
}

/** Validate a 5-field cron expression. Returns an error i18n key or null. */
export function validateCronExpr(expr: string): string | null {
  const trimmed = expr.trim();
  if (!trimmed) return "scheduleRequired";
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return "cronInvalidFormat";
  const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  for (let i = 0; i < 5; i++) {
    if (!isValidCronField(parts[i], ranges[i][0], ranges[i][1])) return "cronInvalidFormat";
  }
  return null;
}

export function validateCronForm(data: CronJobFormData): FormErrors {
  const errors: FormErrors = {};
  if (!data.name.trim()) errors.name = "nameRequired";
  if (data.scheduleKind === "cron") {
    if (!data.cronExpr.trim()) {
      errors.cronExpr = "scheduleRequired";
    } else {
      const cronErr = validateCronExpr(data.cronExpr);
      if (cronErr) errors.cronExpr = cronErr;
    }
  }
  if (data.scheduleKind === "every" && (!data.everyValue || data.everyValue <= 0)) errors.everyValue = "scheduleRequired";
  if (data.scheduleKind === "at" && !data.atDatetime) errors.atDatetime = "scheduleRequired";
  if (data.payloadKind === "agentTurn" && !data.message.trim()) errors.message = "payloadRequired";
  if (data.payloadKind === "systemEvent" && !data.text.trim()) errors.text = "payloadRequired";
  if (data.deliveryMode === "webhook" && !data.deliveryTo.trim()) errors.deliveryTo = "webhookUrlRequired";
  return errors;
}

// ── Date helpers ──

function isoToDatetimeLocal(iso: string): string {
  try {
    const d = new Date(iso);
    // Format as YYYY-MM-DDTHH:mm for datetime-local input
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function datetimeLocalToIso(dt: string): string {
  if (!dt) return new Date().toISOString();
  return new Date(dt).toISOString();
}

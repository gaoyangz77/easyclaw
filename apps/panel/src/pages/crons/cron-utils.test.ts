import { describe, it, expect } from "vitest";
import {
  defaultFormData,
  cronJobToFormData,
  formDataToCreateParams,
  formDataToPatch,
  formatSchedule,
  formatRelativeTime,
  formatDuration,
  validateCronForm,
  validateCronExpr,
  type CronJob,
  type CronJobFormData,
  type CronSchedule,
} from "./cron-utils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCronJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "job-1",
    name: "Test Job",
    enabled: true,
    createdAtMs: 1700000000000,
    updatedAtMs: 1700000000000,
    schedule: { kind: "cron", expr: "*/5 * * * *" },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "Hello" },
    state: {},
    ...overrides,
  };
}

function makeFormData(overrides: Partial<CronJobFormData> = {}): CronJobFormData {
  return { ...defaultFormData(), ...overrides };
}

// ---------------------------------------------------------------------------
// defaultFormData
// ---------------------------------------------------------------------------

describe("defaultFormData", () => {
  it("returns correct defaults", () => {
    const d = defaultFormData();
    expect(d.name).toBe("");
    expect(d.scheduleKind).toBe("cron");
    expect(d.payloadKind).toBe("agentTurn");
    expect(d.enabled).toBe(true);
    expect(d.deleteAfterRun).toBe(false);
    expect(d.wakeMode).toBe("now");
    expect(d.deliveryMode).toBe("none");
    expect(d.everyValue).toBe(60);
    expect(d.everyUnit).toBe("minutes");
  });
});

// ---------------------------------------------------------------------------
// cronJobToFormData
// ---------------------------------------------------------------------------

describe("cronJobToFormData", () => {
  // -- Schedule kinds --

  it("converts cron schedule", () => {
    const job = makeCronJob({
      schedule: { kind: "cron", expr: "0 9 * * 1-5", tz: "America/New_York" },
    });
    const form = cronJobToFormData(job);
    expect(form.scheduleKind).toBe("cron");
    expect(form.cronExpr).toBe("0 9 * * 1-5");
    expect(form.cronTz).toBe("America/New_York");
  });

  it("converts cron schedule without timezone", () => {
    const job = makeCronJob({ schedule: { kind: "cron", expr: "*/10 * * * *" } });
    const form = cronJobToFormData(job);
    expect(form.cronTz).toBe("");
  });

  it("converts every schedule in hours", () => {
    const job = makeCronJob({ schedule: { kind: "every", everyMs: 7200000 } }); // 2 hours
    const form = cronJobToFormData(job);
    expect(form.scheduleKind).toBe("every");
    expect(form.everyValue).toBe(2);
    expect(form.everyUnit).toBe("hours");
  });

  it("converts every schedule in minutes", () => {
    const job = makeCronJob({ schedule: { kind: "every", everyMs: 300000 } }); // 5 minutes
    const form = cronJobToFormData(job);
    expect(form.everyValue).toBe(5);
    expect(form.everyUnit).toBe("minutes");
  });

  it("converts every schedule in seconds", () => {
    const job = makeCronJob({ schedule: { kind: "every", everyMs: 30000 } }); // 30 seconds
    const form = cronJobToFormData(job);
    expect(form.everyValue).toBe(30);
    expect(form.everyUnit).toBe("seconds");
  });

  it("converts non-round interval to seconds", () => {
    // 90 seconds = 90000ms (not evenly divisible by 60000)
    const job = makeCronJob({ schedule: { kind: "every", everyMs: 90000 } });
    const form = cronJobToFormData(job);
    expect(form.everyValue).toBe(90);
    expect(form.everyUnit).toBe("seconds");
  });

  it("converts at schedule", () => {
    const job = makeCronJob({
      schedule: { kind: "at", at: "2026-06-15T14:30:00.000Z" },
    });
    const form = cronJobToFormData(job);
    expect(form.scheduleKind).toBe("at");
    expect(form.atDatetime).toBeTruthy();
  });

  // -- Payload kinds --

  it("converts agentTurn payload", () => {
    const job = makeCronJob({
      payload: {
        kind: "agentTurn",
        message: "Do something",
        model: "opus",
        thinking: "high",
        timeoutSeconds: 120,
      },
    });
    const form = cronJobToFormData(job);
    expect(form.payloadKind).toBe("agentTurn");
    expect(form.message).toBe("Do something");
    expect(form.model).toBe("opus");
    expect(form.thinking).toBe("high");
    expect(form.timeoutSeconds).toBe("120");
  });

  it("converts agentTurn payload with no optional fields", () => {
    const job = makeCronJob({
      payload: { kind: "agentTurn", message: "Hello" },
    });
    const form = cronJobToFormData(job);
    expect(form.model).toBe("");
    expect(form.thinking).toBe("");
    expect(form.timeoutSeconds).toBe("");
  });

  it("converts systemEvent payload", () => {
    const job = makeCronJob({
      sessionTarget: "main",
      payload: { kind: "systemEvent", text: "Reminder text" },
    });
    const form = cronJobToFormData(job);
    expect(form.payloadKind).toBe("systemEvent");
    expect(form.text).toBe("Reminder text");
  });

  // -- Delivery --

  it("converts delivery config", () => {
    const job = makeCronJob({
      delivery: { mode: "webhook", to: "https://example.com/hook", bestEffort: true },
    });
    const form = cronJobToFormData(job);
    expect(form.deliveryMode).toBe("webhook");
    expect(form.deliveryTo).toBe("https://example.com/hook");
  });

  it("defaults delivery to none when absent", () => {
    const job = makeCronJob({ delivery: undefined });
    const form = cronJobToFormData(job);
    expect(form.deliveryMode).toBe("none");
  });

  // -- Other fields --

  it("converts basic fields", () => {
    const job = makeCronJob({
      name: "My Job",
      description: "Desc",
      enabled: false,
      deleteAfterRun: true,
      wakeMode: "next-heartbeat",
    });
    const form = cronJobToFormData(job);
    expect(form.name).toBe("My Job");
    expect(form.description).toBe("Desc");
    expect(form.enabled).toBe(false);
    expect(form.deleteAfterRun).toBe(true);
    expect(form.wakeMode).toBe("next-heartbeat");
  });

  it("handles missing description", () => {
    const job = makeCronJob({ description: undefined });
    const form = cronJobToFormData(job);
    expect(form.description).toBe("");
  });
});

// ---------------------------------------------------------------------------
// formDataToCreateParams
// ---------------------------------------------------------------------------

describe("formDataToCreateParams", () => {
  it("creates params for agentTurn with cron schedule", () => {
    const form = makeFormData({
      name: "Daily Brief",
      cronExpr: "0 9 * * *",
      cronTz: "UTC",
      payloadKind: "agentTurn",
      message: "Give me a briefing",
    });
    const params = formDataToCreateParams(form);
    expect(params.name).toBe("Daily Brief");
    expect(params.sessionTarget).toBe("isolated");
    expect(params.schedule).toEqual({ kind: "cron", expr: "0 9 * * *", tz: "UTC" });
    expect(params.payload).toEqual({ kind: "agentTurn", message: "Give me a briefing" });
    expect(params.enabled).toBe(true);
  });

  it("creates params for systemEvent with at schedule", () => {
    const form = makeFormData({
      name: "Reminder",
      scheduleKind: "at",
      atDatetime: "2026-06-15T14:30",
      payloadKind: "systemEvent",
      text: "Check the docs",
      deleteAfterRun: true,
    });
    const params = formDataToCreateParams(form);
    expect(params.sessionTarget).toBe("main");
    expect((params.schedule as { kind: string }).kind).toBe("at");
    expect(params.payload).toEqual({ kind: "systemEvent", text: "Check the docs" });
    expect(params.deleteAfterRun).toBe(true);
  });

  it("creates params with every schedule (minutes)", () => {
    const form = makeFormData({
      name: "Periodic",
      scheduleKind: "every",
      everyValue: 30,
      everyUnit: "minutes",
      payloadKind: "agentTurn",
      message: "Check status",
    });
    const params = formDataToCreateParams(form);
    expect(params.schedule).toEqual({ kind: "every", everyMs: 1800000 });
  });

  it("creates params with every schedule (hours)", () => {
    const form = makeFormData({
      name: "Hourly",
      scheduleKind: "every",
      everyValue: 2,
      everyUnit: "hours",
      payloadKind: "agentTurn",
      message: "Check",
    });
    const params = formDataToCreateParams(form);
    expect(params.schedule).toEqual({ kind: "every", everyMs: 7200000 });
  });

  it("creates params with every schedule (seconds)", () => {
    const form = makeFormData({
      name: "Frequent",
      scheduleKind: "every",
      everyValue: 45,
      everyUnit: "seconds",
      payloadKind: "agentTurn",
      message: "Ping",
    });
    const params = formDataToCreateParams(form);
    expect(params.schedule).toEqual({ kind: "every", everyMs: 45000 });
  });

  it("includes advanced agentTurn fields when set", () => {
    const form = makeFormData({
      name: "Advanced",
      payloadKind: "agentTurn",
      message: "Do it",
      model: "sonnet",
      thinking: "low",
      timeoutSeconds: "60",
    });
    const params = formDataToCreateParams(form);
    const payload = params.payload as { kind: string; model?: string; thinking?: string; timeoutSeconds?: number };
    expect(payload.model).toBe("sonnet");
    expect(payload.thinking).toBe("low");
    expect(payload.timeoutSeconds).toBe(60);
  });

  it("omits empty optional fields", () => {
    const form = makeFormData({
      name: "Simple",
      payloadKind: "agentTurn",
      message: "Hello",
      model: "",
      thinking: "",
      timeoutSeconds: "",
      description: "",
    });
    const params = formDataToCreateParams(form);
    expect(params).not.toHaveProperty("description");
    const payload = params.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("model");
    expect(payload).not.toHaveProperty("thinking");
    expect(payload).not.toHaveProperty("timeoutSeconds");
  });

  it("includes description when present", () => {
    const form = makeFormData({
      name: "Named",
      description: "A description",
      payloadKind: "agentTurn",
      message: "Hi",
    });
    const params = formDataToCreateParams(form);
    expect(params.description).toBe("A description");
  });

  it("includes delivery for agentTurn with non-none mode", () => {
    const form = makeFormData({
      name: "Delivered",
      payloadKind: "agentTurn",
      message: "Report",
      deliveryMode: "webhook",
      deliveryTo: "https://hooks.example.com",
    });
    const params = formDataToCreateParams(form);
    expect(params.delivery).toEqual({ mode: "webhook", to: "https://hooks.example.com" });
  });

  it("excludes delivery when mode is none", () => {
    const form = makeFormData({
      name: "No delivery",
      payloadKind: "agentTurn",
      message: "Hi",
      deliveryMode: "none",
    });
    const params = formDataToCreateParams(form);
    expect(params).not.toHaveProperty("delivery");
  });

  it("excludes delivery for systemEvent even if mode is set", () => {
    const form = makeFormData({
      name: "System",
      payloadKind: "systemEvent",
      text: "Check",
      deliveryMode: "announce",
      deliveryChannel: "slack",
    });
    const params = formDataToCreateParams(form);
    expect(params).not.toHaveProperty("delivery");
  });

  it("includes announce delivery with channel", () => {
    const form = makeFormData({
      name: "Announce",
      payloadKind: "agentTurn",
      message: "News",
      deliveryMode: "announce",
      deliveryChannel: "telegram",
    });
    const params = formDataToCreateParams(form);
    expect(params.delivery).toEqual({ mode: "announce", channel: "telegram" });
  });

  it("omits cronTz when empty", () => {
    const form = makeFormData({
      name: "No TZ",
      cronExpr: "0 * * * *",
      cronTz: "",
      payloadKind: "agentTurn",
      message: "Hi",
    });
    const params = formDataToCreateParams(form);
    expect(params.schedule).toEqual({ kind: "cron", expr: "0 * * * *" });
  });

  it("trims whitespace from fields", () => {
    const form = makeFormData({
      name: "  Spaces  ",
      description: "  desc  ",
      cronExpr: "  0 * * * *  ",
      payloadKind: "agentTurn",
      message: "  msg  ",
    });
    const params = formDataToCreateParams(form);
    expect(params.name).toBe("Spaces");
    expect(params.description).toBe("desc");
    expect((params.schedule as { expr: string }).expr).toBe("0 * * * *");
    expect((params.payload as { message: string }).message).toBe("msg");
  });
});

// ---------------------------------------------------------------------------
// formDataToPatch
// ---------------------------------------------------------------------------

describe("formDataToPatch", () => {
  it("detects name change", () => {
    const original = makeCronJob({ name: "Old" });
    const form = cronJobToFormData(original);
    form.name = "New";
    const patch = formDataToPatch(original, form);
    expect(patch.name).toBe("New");
  });

  it("detects enabled change", () => {
    const original = makeCronJob({ enabled: true });
    const form = cronJobToFormData(original);
    form.enabled = false;
    const patch = formDataToPatch(original, form);
    expect(patch.enabled).toBe(false);
  });

  it("always includes schedule and payload", () => {
    const original = makeCronJob();
    const form = cronJobToFormData(original);
    const patch = formDataToPatch(original, form);
    expect(patch).toHaveProperty("schedule");
    expect(patch).toHaveProperty("payload");
  });

  it("clears delivery when switching from webhook to none", () => {
    const original = makeCronJob({
      delivery: { mode: "webhook", to: "https://example.com" },
    });
    const form = cronJobToFormData(original);
    form.deliveryMode = "none";
    const patch = formDataToPatch(original, form);
    expect(patch.delivery).toEqual({ mode: "none" });
  });

  it("does not include unchanged name", () => {
    const original = makeCronJob({ name: "Same" });
    const form = cronJobToFormData(original);
    const patch = formDataToPatch(original, form);
    expect(patch).not.toHaveProperty("name");
  });

  it("detects sessionTarget change when payload kind changes", () => {
    const original = makeCronJob({
      sessionTarget: "isolated",
      payload: { kind: "agentTurn", message: "Hi" },
    });
    const form = cronJobToFormData(original);
    form.payloadKind = "systemEvent";
    form.text = "System text";
    const patch = formDataToPatch(original, form);
    expect(patch.sessionTarget).toBe("main");
  });
});

// ---------------------------------------------------------------------------
// formatSchedule
// ---------------------------------------------------------------------------

describe("formatSchedule", () => {
  it("formats cron schedule", () => {
    const s: CronSchedule = { kind: "cron", expr: "*/5 * * * *" };
    expect(formatSchedule(s)).toBe("*/5 * * * *");
  });

  it("formats cron schedule with timezone", () => {
    const s: CronSchedule = { kind: "cron", expr: "0 9 * * *", tz: "US/Eastern" };
    expect(formatSchedule(s)).toBe("0 9 * * * (US/Eastern)");
  });

  it("formats every schedule in hours", () => {
    expect(formatSchedule({ kind: "every", everyMs: 3600000 })).toBe("Every 1h");
    expect(formatSchedule({ kind: "every", everyMs: 7200000 })).toBe("Every 2h");
  });

  it("formats every schedule in minutes", () => {
    expect(formatSchedule({ kind: "every", everyMs: 60000 })).toBe("Every 1m");
    expect(formatSchedule({ kind: "every", everyMs: 300000 })).toBe("Every 5m");
  });

  it("formats every schedule in seconds", () => {
    expect(formatSchedule({ kind: "every", everyMs: 30000 })).toBe("Every 30s");
    expect(formatSchedule({ kind: "every", everyMs: 1000 })).toBe("Every 1s");
  });

  it("formats at schedule as localized date", () => {
    const s: CronSchedule = { kind: "at", at: "2026-06-15T14:30:00.000Z" };
    const result = formatSchedule(s);
    // The exact format depends on locale, but should contain the date
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(5);
  });

  it("returns raw string for invalid at date", () => {
    const s: CronSchedule = { kind: "at", at: "not-a-date" };
    const result = formatSchedule(s);
    // Should not throw, returns something
    expect(result).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
  const now = 1700000000000;

  it("formats seconds in the future", () => {
    expect(formatRelativeTime(now + 30000, now)).toBe("in 30s");
  });

  it("formats seconds in the past", () => {
    expect(formatRelativeTime(now - 45000, now)).toBe("45s ago");
  });

  it("formats minutes in the future", () => {
    expect(formatRelativeTime(now + 300000, now)).toBe("in 5m");
  });

  it("formats minutes in the past", () => {
    expect(formatRelativeTime(now - 600000, now)).toBe("10m ago");
  });

  it("formats hours in the future", () => {
    expect(formatRelativeTime(now + 7200000, now)).toBe("in 2h");
  });

  it("formats hours in the past", () => {
    expect(formatRelativeTime(now - 10800000, now)).toBe("3h ago");
  });

  it("formats days in the future", () => {
    expect(formatRelativeTime(now + 172800000, now)).toBe("in 2d");
  });

  it("formats days in the past", () => {
    expect(formatRelativeTime(now - 259200000, now)).toBe("3d ago");
  });

  it("handles exact boundary (60s = 1m)", () => {
    expect(formatRelativeTime(now + 60000, now)).toBe("in 1m");
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(0)).toBe("0ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(30000)).toBe("30.0s");
  });

  it("formats minutes", () => {
    expect(formatDuration(90000)).toBe("1.5m");
    expect(formatDuration(300000)).toBe("5.0m");
  });
});

// ---------------------------------------------------------------------------
// validateCronForm
// ---------------------------------------------------------------------------

describe("validateCronForm", () => {
  it("returns empty for valid agentTurn with cron schedule", () => {
    const form = makeFormData({
      name: "Valid",
      cronExpr: "0 * * * *",
      payloadKind: "agentTurn",
      message: "Hello",
    });
    expect(validateCronForm(form)).toEqual({});
  });

  it("returns empty for valid systemEvent with at schedule", () => {
    const form = makeFormData({
      name: "Valid",
      scheduleKind: "at",
      atDatetime: "2026-06-15T14:30",
      payloadKind: "systemEvent",
      text: "Reminder",
    });
    expect(validateCronForm(form)).toEqual({});
  });

  it("requires name", () => {
    const form = makeFormData({
      name: "",
      cronExpr: "0 * * * *",
      payloadKind: "agentTurn",
      message: "Hi",
    });
    const errors = validateCronForm(form);
    expect(errors.name).toBe("nameRequired");
  });

  it("requires name (whitespace only)", () => {
    const form = makeFormData({
      name: "   ",
      cronExpr: "0 * * * *",
      payloadKind: "agentTurn",
      message: "Hi",
    });
    const errors = validateCronForm(form);
    expect(errors.name).toBe("nameRequired");
  });

  it("requires cron expression for cron schedule", () => {
    const form = makeFormData({
      name: "Test",
      scheduleKind: "cron",
      cronExpr: "",
      payloadKind: "agentTurn",
      message: "Hi",
    });
    const errors = validateCronForm(form);
    expect(errors.cronExpr).toBe("scheduleRequired");
  });

  it("requires positive interval for every schedule", () => {
    const form = makeFormData({
      name: "Test",
      scheduleKind: "every",
      everyValue: 0,
      payloadKind: "agentTurn",
      message: "Hi",
    });
    const errors = validateCronForm(form);
    expect(errors.everyValue).toBe("scheduleRequired");
  });

  it("requires negative interval for every schedule", () => {
    const form = makeFormData({
      name: "Test",
      scheduleKind: "every",
      everyValue: -5,
      payloadKind: "agentTurn",
      message: "Hi",
    });
    const errors = validateCronForm(form);
    expect(errors.everyValue).toBe("scheduleRequired");
  });

  it("requires datetime for at schedule", () => {
    const form = makeFormData({
      name: "Test",
      scheduleKind: "at",
      atDatetime: "",
      payloadKind: "agentTurn",
      message: "Hi",
    });
    const errors = validateCronForm(form);
    expect(errors.atDatetime).toBe("scheduleRequired");
  });

  it("requires message for agentTurn", () => {
    const form = makeFormData({
      name: "Test",
      cronExpr: "0 * * * *",
      payloadKind: "agentTurn",
      message: "",
    });
    const errors = validateCronForm(form);
    expect(errors.message).toBe("payloadRequired");
  });

  it("requires text for systemEvent", () => {
    const form = makeFormData({
      name: "Test",
      cronExpr: "0 * * * *",
      payloadKind: "systemEvent",
      text: "",
    });
    const errors = validateCronForm(form);
    expect(errors.text).toBe("payloadRequired");
  });

  it("requires webhook URL when delivery mode is webhook", () => {
    const form = makeFormData({
      name: "Test",
      cronExpr: "0 * * * *",
      payloadKind: "agentTurn",
      message: "Hi",
      deliveryMode: "webhook",
      deliveryTo: "",
    });
    const errors = validateCronForm(form);
    expect(errors.deliveryTo).toBe("webhookUrlRequired");
  });

  it("does not require webhook URL when delivery mode is not webhook", () => {
    const form = makeFormData({
      name: "Test",
      cronExpr: "0 * * * *",
      payloadKind: "agentTurn",
      message: "Hi",
      deliveryMode: "announce",
      deliveryTo: "",
    });
    const errors = validateCronForm(form);
    expect(errors).not.toHaveProperty("deliveryTo");
  });

  it("reports multiple errors at once", () => {
    const form = makeFormData({
      name: "",
      scheduleKind: "cron",
      cronExpr: "",
      payloadKind: "agentTurn",
      message: "",
    });
    const errors = validateCronForm(form);
    expect(Object.keys(errors).length).toBe(3);
    expect(errors.name).toBeDefined();
    expect(errors.cronExpr).toBeDefined();
    expect(errors.message).toBeDefined();
  });

  it("accepts valid every schedule", () => {
    const form = makeFormData({
      name: "Test",
      scheduleKind: "every",
      everyValue: 30,
      everyUnit: "minutes",
      payloadKind: "agentTurn",
      message: "Hi",
    });
    expect(validateCronForm(form)).toEqual({});
  });
  it("rejects invalid cron expression", () => {
    const form = makeFormData({
      name: "Test",
      scheduleKind: "cron",
      cronExpr: "not a cron",
      payloadKind: "agentTurn",
      message: "Hi",
    });
    const errors = validateCronForm(form);
    expect(errors.cronExpr).toBe("cronInvalidFormat");
  });

  it("rejects cron with wrong number of fields", () => {
    const form = makeFormData({
      name: "Test",
      scheduleKind: "cron",
      cronExpr: "0 * *",
      payloadKind: "agentTurn",
      message: "Hi",
    });
    const errors = validateCronForm(form);
    expect(errors.cronExpr).toBe("cronInvalidFormat");
  });

  it("rejects cron with out-of-range values", () => {
    const form = makeFormData({
      name: "Test",
      scheduleKind: "cron",
      cronExpr: "60 * * * *",
      payloadKind: "agentTurn",
      message: "Hi",
    });
    const errors = validateCronForm(form);
    expect(errors.cronExpr).toBe("cronInvalidFormat");
  });
});

// ---------------------------------------------------------------------------
// validateCronExpr
// ---------------------------------------------------------------------------

describe("validateCronExpr", () => {
  it("accepts standard expressions", () => {
    expect(validateCronExpr("* * * * *")).toBeNull();
    expect(validateCronExpr("0 9 * * 1")).toBeNull();
    expect(validateCronExpr("*/5 * * * *")).toBeNull();
    expect(validateCronExpr("0 0 1 * *")).toBeNull();
  });

  it("accepts ranges", () => {
    expect(validateCronExpr("0-30 * * * *")).toBeNull();
    expect(validateCronExpr("* 9-17 * * 1-5")).toBeNull();
  });

  it("accepts lists", () => {
    expect(validateCronExpr("0,15,30,45 * * * *")).toBeNull();
    expect(validateCronExpr("* * * * 0,6")).toBeNull();
  });

  it("accepts steps with ranges", () => {
    expect(validateCronExpr("1-30/5 * * * *")).toBeNull();
    expect(validateCronExpr("* */2 * * *")).toBeNull();
  });

  it("rejects empty", () => {
    expect(validateCronExpr("")).toBe("scheduleRequired");
    expect(validateCronExpr("   ")).toBe("scheduleRequired");
  });

  it("rejects wrong number of fields", () => {
    expect(validateCronExpr("* * *")).toBe("cronInvalidFormat");
    expect(validateCronExpr("* * * * * *")).toBe("cronInvalidFormat");
  });

  it("rejects out-of-range minutes", () => {
    expect(validateCronExpr("60 * * * *")).toBe("cronInvalidFormat");
  });

  it("rejects out-of-range hours", () => {
    expect(validateCronExpr("* 24 * * *")).toBe("cronInvalidFormat");
  });

  it("rejects out-of-range day-of-month", () => {
    expect(validateCronExpr("* * 0 * *")).toBe("cronInvalidFormat");
    expect(validateCronExpr("* * 32 * *")).toBe("cronInvalidFormat");
  });

  it("rejects out-of-range month", () => {
    expect(validateCronExpr("* * * 0 *")).toBe("cronInvalidFormat");
    expect(validateCronExpr("* * * 13 *")).toBe("cronInvalidFormat");
  });

  it("rejects out-of-range weekday", () => {
    expect(validateCronExpr("* * * * 8")).toBe("cronInvalidFormat");
  });

  it("accepts weekday 7 (some cron impls allow 0-7)", () => {
    expect(validateCronExpr("* * * * 7")).toBeNull();
  });

  it("rejects invalid characters", () => {
    expect(validateCronExpr("abc * * * *")).toBe("cronInvalidFormat");
    expect(validateCronExpr("* * * * L")).toBe("cronInvalidFormat");
  });

  it("rejects reversed range", () => {
    expect(validateCronExpr("30-10 * * * *")).toBe("cronInvalidFormat");
  });
});

// ---------------------------------------------------------------------------
// Round-trip: cronJobToFormData → formDataToCreateParams
// ---------------------------------------------------------------------------

describe("round-trip conversion", () => {
  it("preserves agentTurn cron job through form conversion", () => {
    const original = makeCronJob({
      name: "Morning Brief",
      description: "Daily morning briefing",
      schedule: { kind: "cron", expr: "0 8 * * *", tz: "Asia/Shanghai" },
      sessionTarget: "isolated",
      payload: { kind: "agentTurn", message: "Give me today's brief", model: "opus" },
      wakeMode: "now",
      enabled: true,
    });
    const form = cronJobToFormData(original);
    const params = formDataToCreateParams(form);

    expect(params.name).toBe("Morning Brief");
    expect(params.description).toBe("Daily morning briefing");
    expect(params.schedule).toEqual({ kind: "cron", expr: "0 8 * * *", tz: "Asia/Shanghai" });
    expect(params.sessionTarget).toBe("isolated");
    expect(params.wakeMode).toBe("now");
    expect(params.enabled).toBe(true);
    const payload = params.payload as { kind: string; message: string; model: string };
    expect(payload.kind).toBe("agentTurn");
    expect(payload.message).toBe("Give me today's brief");
    expect(payload.model).toBe("opus");
  });

  it("preserves systemEvent at job through form conversion", () => {
    const isoDate = "2026-12-25T10:00:00.000Z";
    const original = makeCronJob({
      name: "Xmas Reminder",
      schedule: { kind: "at", at: isoDate },
      sessionTarget: "main",
      payload: { kind: "systemEvent", text: "Merry Christmas!" },
      deleteAfterRun: true,
    });
    const form = cronJobToFormData(original);
    const params = formDataToCreateParams(form);

    expect(params.name).toBe("Xmas Reminder");
    expect(params.sessionTarget).toBe("main");
    expect(params.deleteAfterRun).toBe(true);
    expect((params.payload as { text: string }).text).toBe("Merry Christmas!");
    expect((params.schedule as { kind: string }).kind).toBe("at");
  });

  it("preserves every schedule through form conversion", () => {
    const original = makeCronJob({
      name: "Interval Job",
      schedule: { kind: "every", everyMs: 1800000 }, // 30 minutes
      payload: { kind: "agentTurn", message: "Status check" },
    });
    const form = cronJobToFormData(original);
    const params = formDataToCreateParams(form);

    expect(params.schedule).toEqual({ kind: "every", everyMs: 1800000 });
  });
});

import { test, expect } from "./electron-fixture.js";

/**
 * Helper: dismiss any modal(s) blocking the UI (e.g. "What's New", telemetry consent).
 */
async function dismissModals(window: import("@playwright/test").Page) {
  for (let i = 0; i < 3; i++) {
    const backdrop = window.locator(".modal-backdrop");
    if (!await backdrop.isVisible({ timeout: 3_000 }).catch(() => false)) break;
    const closeBtn = backdrop.locator(".modal-close-btn");
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeBtn.click();
    } else {
      await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    }
    await backdrop.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
  }
}

/**
 * Helper: navigate to Crons page and wait for gateway connection.
 */
async function navigateToCrons(window: import("@playwright/test").Page) {
  await dismissModals(window);
  const cronsBtn = window.locator(".nav-btn", { hasText: "Cron Jobs" });
  await cronsBtn.click();
  await expect(cronsBtn).toHaveClass(/nav-active/);
  await expect(window.locator(".crons-status-dot-connected")).toBeVisible({ timeout: 30_000 });
}

/**
 * Helper: open the Create Cron Job form and return the modal locator.
 */
async function openCreateForm(window: import("@playwright/test").Page) {
  const addBtn = window.locator(".crons-toolbar .btn-primary", { hasText: "Add Job" });
  await addBtn.click();
  const modal = window.locator(".modal-backdrop");
  await expect(modal).toBeVisible();
  await expect(modal.locator(".modal-header")).toContainText("Create Cron Job");
  return modal;
}

/**
 * Helper: fill the name field in the cron form modal.
 */
async function fillName(modal: import("@playwright/test").Locator, name: string) {
  const nameInput = modal.locator("input.input-full").first();
  await nameInput.fill(name);
}

/**
 * Helper: fill the message/text textarea (rows=3, the payload content field).
 * Description textarea has rows=2, so rows=3 uniquely targets the payload field.
 */
async function fillPayloadText(modal: import("@playwright/test").Locator, text: string) {
  const textarea = modal.locator("textarea[rows='3']");
  await textarea.fill(text);
}

/**
 * Helper: submit the cron form and wait for the modal to close.
 */
async function submitForm(modal: import("@playwright/test").Locator, buttonText: string = "Add Job") {
  const submitBtn = modal.locator(".modal-actions .btn-primary", { hasText: buttonText });
  await submitBtn.click();
  await expect(modal).toBeHidden({ timeout: 15_000 });
}

/**
 * Helper: click a Select trigger and pick an option by text.
 * Uses the portal-rendered dropdown on document.body.
 */
async function selectOption(
  window: import("@playwright/test").Page,
  triggerLocator: import("@playwright/test").Locator,
  optionText: string,
) {
  await triggerLocator.click();
  const option = window.locator(".custom-select-option", { hasText: optionText });
  await option.click();
}

/**
 * Helper: create a simple interval job.
 */
async function createIntervalJob(
  window: import("@playwright/test").Page,
  name: string,
  opts?: { intervalValue?: string; unit?: string; message?: string },
) {
  const modal = await openCreateForm(window);
  await fillName(modal, name);

  // Select Interval schedule type
  const intervalBtn = modal.locator(".crons-schedule-type-btn", { hasText: "Interval" });
  await intervalBtn.click();

  // Fill interval value
  const intervalInput = modal.locator("input[type='number']");
  await intervalInput.fill(opts?.intervalValue ?? "30");

  // Select unit if specified
  if (opts?.unit) {
    const unitSelect = modal.locator(".crons-form-row .custom-select-trigger");
    await selectOption(window, unitSelect, opts.unit);
  }

  // Fill message (payload textarea has rows=3)
  await fillPayloadText(modal, opts?.message ?? "Hello from E2E");

  await submitForm(modal);
}

/**
 * Helper: delete a job by clicking Delete on its row and confirming.
 */
async function deleteJob(window: import("@playwright/test").Page, jobName: string) {
  const table = window.locator(".crons-table");
  const row = table.locator("tr", { hasText: jobName });
  const deleteBtn = row.locator(".btn-danger", { hasText: "Delete" });
  await deleteBtn.click();

  const confirmDialog = window.locator(".modal-backdrop");
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText(jobName);
  const confirmBtn = confirmDialog.locator(".btn-danger", { hasText: "Delete" });
  await confirmBtn.click();
  await expect(confirmDialog).toBeHidden({ timeout: 10_000 });
}


test.describe("Crons Page", () => {

  // ──────────────────────────────────────────────────────────
  // 1. Page navigation & empty state
  // ──────────────────────────────────────────────────────────

  test("navigates to crons page and shows empty state", async ({ window }) => {
    await navigateToCrons(window);

    // Page title (scoped to avoid matching other page h1s still in DOM)
    await expect(window.locator("h1", { hasText: "Cron Jobs" })).toBeVisible();

    // Page description
    await expect(window.locator(".page-description")).toBeVisible();

    // Connection status bar
    const statusBar = window.locator(".crons-status-bar");
    await expect(statusBar).toBeVisible();
    await expect(statusBar).toContainText("Connected");

    // Empty state since no jobs exist
    await expect(window.locator(".empty-state")).toBeVisible({ timeout: 10_000 });

    // Toolbar with search, filters, and Add Job button
    const toolbar = window.locator(".crons-toolbar");
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator(".crons-search-input")).toBeVisible();
    await expect(toolbar.locator(".crons-filter-select")).toHaveCount(2); // enabled + sort
    const addBtn = toolbar.locator(".btn-primary", { hasText: "Add Job" });
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toBeEnabled();
  });

  // ──────────────────────────────────────────────────────────
  // 2. Full CRUD lifecycle: create, edit, toggle, run, history, delete
  // ──────────────────────────────────────────────────────────

  test("CRUD lifecycle with interval schedule", async ({ window }) => {
    await navigateToCrons(window);

    // ── CREATE ──
    const modal = await openCreateForm(window);
    await fillName(modal, "E2E CRUD Job");

    // Select Interval schedule
    const intervalBtn = modal.locator(".crons-schedule-type-btn", { hasText: "Interval" });
    await intervalBtn.click();
    await expect(intervalBtn).toHaveClass(/crons-schedule-type-btn-active/);

    // Fill interval: 30 minutes
    const intervalInput = modal.locator("input[type='number']");
    await intervalInput.fill("30");

    // Change unit to Minutes
    const unitSelect = modal.locator(".crons-form-row .custom-select-trigger");
    await selectOption(window, unitSelect, "Minutes");

    // Fill Agent Message payload (rows=3 textarea)
    await fillPayloadText(modal, "CRUD test message");

    // Verify enabled checkbox is checked by default
    const enabledCheckbox = modal.locator(".crons-checkbox-label input[type='checkbox']").first();
    await expect(enabledCheckbox).toBeChecked();

    // Submit
    await submitForm(modal);

    // Verify job appears in table
    const table = window.locator(".crons-table");
    await expect(table).toBeVisible({ timeout: 10_000 });
    const jobRow = table.locator("tr", { hasText: "E2E CRUD Job" });
    await expect(jobRow).toBeVisible();

    // Verify schedule text
    await expect(jobRow.locator(".crons-schedule-text")).toContainText("Every 30m");

    // Verify toggle is enabled
    const toggle = jobRow.locator(".toggle-switch input[type='checkbox']");
    await expect(toggle).toBeChecked();

    // Verify status badge shows "Never"
    await expect(jobRow.locator(".badge")).toContainText("Never");

    // ── EDIT ──
    const editBtn = jobRow.locator(".btn", { hasText: "Edit" });
    await editBtn.click();

    const editModal = window.locator(".modal-backdrop");
    await expect(editModal).toBeVisible();
    await expect(editModal.locator(".modal-header")).toContainText("Edit Cron Job");

    // Verify name is pre-filled
    const editNameInput = editModal.locator("input.input-full").first();
    await expect(editNameInput).toHaveValue("E2E CRUD Job");

    // Change name
    await editNameInput.fill("E2E CRUD Job Edited");

    // Save
    await submitForm(editModal, "Save");

    // Verify updated name
    const updatedRow = table.locator("tr", { hasText: "E2E CRUD Job Edited" });
    await expect(updatedRow).toBeVisible({ timeout: 10_000 });

    // ── TOGGLE DISABLE ──
    const updatedToggle = updatedRow.locator(".toggle-switch input[type='checkbox']");
    await expect(updatedToggle).toBeChecked();
    await updatedRow.locator(".toggle-switch").click();
    await expect(updatedToggle).not.toBeChecked({ timeout: 10_000 });

    // ── TOGGLE ENABLE ──
    await updatedRow.locator(".toggle-switch").click();
    await expect(updatedToggle).toBeChecked({ timeout: 10_000 });

    // ── RUN NOW ──
    const runBtn = updatedRow.locator(".btn", { hasText: "Run" });
    await runBtn.click();
    // The job may complete quickly or fail (no LLM configured), but the
    // gateway should accept the command without error.
    await window.waitForTimeout(2_000);

    // ── VIEW HISTORY ──
    const historyBtn = updatedRow.locator(".btn", { hasText: "History" });
    await historyBtn.click();

    const historyModal = window.locator(".modal-backdrop");
    await expect(historyModal).toBeVisible();
    await expect(historyModal.locator(".modal-header")).toContainText("E2E CRUD Job Edited");

    // History may show the run we just triggered, or empty state
    await expect(
      historyModal.locator(".crons-runs-table, .empty-state"),
    ).toBeVisible({ timeout: 10_000 });

    // Close history
    const closeBtn = historyModal.locator(".modal-close-btn");
    await closeBtn.click();
    await expect(historyModal).toBeHidden({ timeout: 5_000 });

    // ── DELETE ──
    await deleteJob(window, "E2E CRUD Job Edited");

    // Back to empty state
    await expect(window.locator(".empty-state")).toBeVisible({ timeout: 10_000 });
  });

  // ──────────────────────────────────────────────────────────
  // 3. Cron expression schedule with presets and visual builder
  // ──────────────────────────────────────────────────────────

  test("create with cron expression preset and visual builder", async ({ window }) => {
    await navigateToCrons(window);

    const modal = await openCreateForm(window);
    await fillName(modal, "Cron Expr Job");

    // Schedule type defaults to "Cron Expression"
    const cronBtn = modal.locator(".crons-schedule-type-btn", { hasText: "Cron Expression" });
    await expect(cronBtn).toHaveClass(/crons-schedule-type-btn-active/);

    // Click "Every 5 min" preset
    const preset5min = modal.locator(".crons-preset-chip", { hasText: "Every 5 min" });
    await preset5min.click();
    await expect(preset5min).toHaveClass(/crons-preset-chip-active/);

    // Verify expression bar shows the cron expression
    await expect(modal.locator(".crons-expr-value")).toContainText("*/5 * * * *");

    // Verify the visual builder reflects the preset (Select triggers show labels)
    const builderFields = modal.locator(".crons-builder-row .custom-select-trigger");
    await expect(builderFields).toHaveCount(5);
    await expect(builderFields.nth(0)).toContainText("Every 5 min"); // minute = */5
    await expect(builderFields.nth(1)).toContainText("Any");          // hour = *
    await expect(builderFields.nth(2)).toContainText("Any");          // day = *
    await expect(builderFields.nth(3)).toContainText("Any");          // month = *
    await expect(builderFields.nth(4)).toContainText("Any");          // weekday = *

    // Change weekday via visual builder to Monday (use exact match to avoid "Mon–Fri")
    await builderFields.nth(4).click();
    await window.locator(".custom-select-option").getByText("Mon", { exact: true }).click();

    // Expression should update to "*/5 * * * 1"
    await expect(modal.locator(".crons-expr-value")).toContainText("*/5 * * * 1");

    // Switch to raw mode via mode toggle
    const rawBtn = modal.locator(".crons-mode-btn", { hasText: "Raw" });
    await rawBtn.click();
    const rawInput = modal.locator(".crons-expr-input");
    await expect(rawInput).toBeVisible();
    await expect(rawInput).toHaveValue("*/5 * * * 1");

    // Fill message (rows=3 textarea)
    await fillPayloadText(modal, "Cron expression test");

    // Submit
    await submitForm(modal);

    // Verify in table
    const table = window.locator(".crons-table");
    const jobRow = table.locator("tr", { hasText: "Cron Expr Job" });
    await expect(jobRow).toBeVisible({ timeout: 10_000 });
    await expect(jobRow.locator(".crons-schedule-text")).toContainText("*/5 * * * 1");

    // Cleanup
    await deleteJob(window, "Cron Expr Job");
  });

  // ──────────────────────────────────────────────────────────
  // 4. One-time schedule with auto delete-after-run
  // ──────────────────────────────────────────────────────────

  test("create with one-time schedule auto-enables delete after run", async ({ window }) => {
    await navigateToCrons(window);

    const modal = await openCreateForm(window);
    await fillName(modal, "One-Time Job");

    // Select One-time schedule
    const atBtn = modal.locator(".crons-schedule-type-btn", { hasText: "One-time" });
    await atBtn.click();
    await expect(atBtn).toHaveClass(/crons-schedule-type-btn-active/);

    // Verify datetime-local input appears
    const datetimeInput = modal.locator("input[type='datetime-local']");
    await expect(datetimeInput).toBeVisible();

    // Set a future datetime
    const future = new Date(Date.now() + 3600000); // 1 hour from now
    const formatted = future.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
    await datetimeInput.fill(formatted);

    // Verify Delete After Run is now auto-enabled
    const deleteAfterRunCheckbox = modal.locator(".crons-checkbox-label", { hasText: "Delete after run" }).locator("input[type='checkbox']");
    await expect(deleteAfterRunCheckbox).toBeChecked();

    // Fill message (rows=3 textarea)
    await fillPayloadText(modal, "One-time test message");

    // Submit
    await submitForm(modal);

    // Verify in table
    const table = window.locator(".crons-table");
    const jobRow = table.locator("tr", { hasText: "One-Time Job" });
    await expect(jobRow).toBeVisible({ timeout: 10_000 });

    // Cleanup
    await deleteJob(window, "One-Time Job");
  });

  // ──────────────────────────────────────────────────────────
  // 5. System Event payload type
  // ──────────────────────────────────────────────────────────

  test("create with system event payload type", async ({ window }) => {
    await navigateToCrons(window);

    const modal = await openCreateForm(window);
    await fillName(modal, "System Event Job");

    // Select Interval schedule
    const intervalBtn = modal.locator(".crons-schedule-type-btn", { hasText: "Interval" });
    await intervalBtn.click();
    const intervalInput = modal.locator("input[type='number']");
    await intervalInput.fill("10");

    // Switch payload type to System Event
    const payloadGroup = modal.locator(".form-group").filter({ hasText: "Payload Type" });
    const payloadSelect = payloadGroup.locator(".custom-select-trigger");
    await selectOption(window, payloadSelect, "System Event");

    // Verify hint text shows "main session" target
    await expect(modal.locator(".form-hint").first()).toContainText(/main session/i);

    // Fill the text field (rows=3 textarea, same selector works after payload switch)
    await fillPayloadText(modal, "System event test text");

    // Verify delivery mode is disabled for system events
    const deliveryHint = modal.locator(".form-hint", { hasText: /only available for Agent/ });
    await expect(deliveryHint).toBeVisible();

    // Submit
    await submitForm(modal);

    // Verify in table
    const table = window.locator(".crons-table");
    const jobRow = table.locator("tr", { hasText: "System Event Job" });
    await expect(jobRow).toBeVisible({ timeout: 10_000 });

    // Cleanup
    await deleteJob(window, "System Event Job");
  });

  // ──────────────────────────────────────────────────────────
  // 6. Form validation
  // ──────────────────────────────────────────────────────────

  test("form validation: required fields", async ({ window }) => {
    await navigateToCrons(window);

    const modal = await openCreateForm(window);

    // Try to submit with all empty fields — cron expression is default schedule type
    const submitBtn = modal.locator(".modal-actions .btn-primary", { hasText: "Add Job" });
    await submitBtn.click();

    // Modal should stay open
    await expect(modal).toBeVisible();

    // Should show validation errors (name + schedule + payload = at least 2-3)
    const fieldErrors = modal.locator(".crons-field-error");
    const errorCount = await fieldErrors.count();
    expect(errorCount).toBeGreaterThanOrEqual(2);

    // Fill name to clear that error
    await fillName(modal, "Validation Test");

    // Select a preset to provide schedule
    const preset = modal.locator(".crons-preset-chip", { hasText: "Every minute" });
    await preset.click();

    // Fill message (rows=3 textarea)
    await fillPayloadText(modal, "Validation test message");

    // Now should submit successfully
    await submitBtn.click();
    await expect(modal).toBeHidden({ timeout: 15_000 });

    // Cleanup
    await deleteJob(window, "Validation Test");
  });

  // ──────────────────────────────────────────────────────────
  // 7. Webhook delivery mode validation
  // ──────────────────────────────────────────────────────────

  test("webhook delivery requires URL", async ({ window }) => {
    await navigateToCrons(window);

    const modal = await openCreateForm(window);
    await fillName(modal, "Webhook Job");

    // Set interval schedule
    const intervalBtn = modal.locator(".crons-schedule-type-btn", { hasText: "Interval" });
    await intervalBtn.click();
    const intervalInput = modal.locator("input[type='number']");
    await intervalInput.fill("60");

    // Fill message (rows=3 textarea)
    await fillPayloadText(modal, "Webhook test");

    // Change delivery mode to Webhook
    // The label is "Delivery" per i18n; when mode is "None" (default), there's one trigger
    const deliveryGroup = modal.locator(".form-group").filter({ hasText: "Delivery" });
    const deliverySelect = deliveryGroup.locator(".custom-select-trigger").first();
    await selectOption(window, deliverySelect, "Webhook");

    // Webhook URL input should appear
    const webhookInput = modal.locator("input[placeholder='https://example.com/webhook']");
    await expect(webhookInput).toBeVisible();

    // Try to submit without webhook URL
    const submitBtn = modal.locator(".modal-actions .btn-primary", { hasText: "Add Job" });
    await submitBtn.click();

    // Should show webhook URL error
    await expect(modal).toBeVisible();
    await expect(modal.locator(".crons-field-error")).toBeVisible();

    // Fill webhook URL
    await webhookInput.fill("https://example.com/my-webhook");

    // Now should submit
    await submitBtn.click();
    await expect(modal).toBeHidden({ timeout: 15_000 });

    // Cleanup
    await deleteJob(window, "Webhook Job");
  });

  // ──────────────────────────────────────────────────────────
  // 8. Advanced options: thinking mode and wake mode
  // ──────────────────────────────────────────────────────────

  test("advanced options: thinking mode and wake mode", async ({ window }) => {
    await navigateToCrons(window);

    const modal = await openCreateForm(window);
    await fillName(modal, "Advanced Options Job");

    // Set interval schedule
    const intervalBtn = modal.locator(".crons-schedule-type-btn", { hasText: "Interval" });
    await intervalBtn.click();
    const intervalInput = modal.locator("input[type='number']");
    await intervalInput.fill("60");

    // Fill message (rows=3 textarea)
    await fillPayloadText(modal, "Advanced test");

    // Open advanced options (the last .crons-advanced-toggle, after the raw cron one)
    const advancedToggle = modal.locator(".crons-advanced-toggle").last();
    await advancedToggle.click();
    await expect(modal.locator(".crons-advanced-content")).toBeVisible();

    // Change thinking mode to "High"
    const thinkingGroup = modal.locator(".form-group").filter({ hasText: "Thinking Mode" });
    const thinkingSelect = thinkingGroup.locator(".custom-select-trigger");
    await selectOption(window, thinkingSelect, "High");

    // Set timeout
    const timeoutInput = modal.locator("input[placeholder='300']");
    await timeoutInput.fill("600");

    // Change wake mode to "Next heartbeat"
    const wakeModeGroup = modal.locator(".form-group").filter({ hasText: "Wake Mode" });
    const wakeModeSelect = wakeModeGroup.locator(".custom-select-trigger");
    await selectOption(window, wakeModeSelect, "Next heartbeat");

    // Submit
    await submitForm(modal);

    // Verify created
    const table = window.locator(".crons-table");
    const jobRow = table.locator("tr", { hasText: "Advanced Options Job" });
    await expect(jobRow).toBeVisible({ timeout: 10_000 });

    // Edit and verify advanced options were persisted
    const editBtn = jobRow.locator(".btn", { hasText: "Edit" });
    await editBtn.click();

    const editModal = window.locator(".modal-backdrop");
    await expect(editModal).toBeVisible();

    // Open advanced options in edit mode
    const editAdvancedToggle = editModal.locator(".crons-advanced-toggle").last();
    await editAdvancedToggle.click();

    // Verify thinking mode shows "High"
    const editThinkingGroup = editModal.locator(".form-group").filter({ hasText: "Thinking Mode" });
    await expect(editThinkingGroup.locator(".custom-select-trigger")).toContainText("High");

    // Verify timeout shows 600
    const editTimeoutInput = editModal.locator("input[placeholder='300']");
    await expect(editTimeoutInput).toHaveValue("600");

    // Verify wake mode shows "Next heartbeat"
    const editWakeModeGroup = editModal.locator(".form-group").filter({ hasText: "Wake Mode" });
    await expect(editWakeModeGroup.locator(".custom-select-trigger")).toContainText("Next heartbeat");

    // Cancel edit
    const cancelBtn = editModal.locator(".modal-actions .btn-secondary", { hasText: "Cancel" });
    await cancelBtn.click();
    await expect(editModal).toBeHidden({ timeout: 5_000 });

    // Cleanup
    await deleteJob(window, "Advanced Options Job");
  });

  // ──────────────────────────────────────────────────────────
  // 9. Search and filter
  // ──────────────────────────────────────────────────────────

  test("search and filter jobs", async ({ window }) => {
    await navigateToCrons(window);

    // Create two jobs
    await createIntervalJob(window, "Alpha Job", { intervalValue: "60", message: "Alpha message" });
    await createIntervalJob(window, "Beta Job", { intervalValue: "120", message: "Beta message" });

    // Wait for both to appear
    const table = window.locator(".crons-table");
    await expect(table.locator("tr", { hasText: "Alpha Job" })).toBeVisible({ timeout: 10_000 });
    await expect(table.locator("tr", { hasText: "Beta Job" })).toBeVisible({ timeout: 10_000 });

    // ── Search by name ──
    const searchInput = window.locator(".crons-search-input");
    await searchInput.fill("Alpha");
    // Wait for the search to take effect (re-fetch from gateway)
    await window.waitForTimeout(1_000);
    await expect(table.locator("tr", { hasText: "Alpha Job" })).toBeVisible({ timeout: 10_000 });
    // Beta should not be visible
    await expect(table.locator("tr", { hasText: "Beta Job" })).not.toBeVisible({ timeout: 5_000 });

    // Clear search
    await searchInput.fill("");
    await window.waitForTimeout(1_000);
    await expect(table.locator("tr", { hasText: "Beta Job" })).toBeVisible({ timeout: 10_000 });

    // ── Filter by enabled/disabled ──
    // First disable Beta Job
    const betaRow = table.locator("tr", { hasText: "Beta Job" });
    await betaRow.locator(".toggle-switch").click();
    await expect(betaRow.locator(".toggle-switch input[type='checkbox']")).not.toBeChecked({ timeout: 10_000 });

    // Filter to "Enabled" only
    const filterSelects = window.locator(".crons-filter-select .custom-select-trigger");
    await selectOption(window, filterSelects.first(), "Enabled");
    await window.waitForTimeout(1_000);

    // Alpha should be visible, Beta should not
    await expect(table.locator("tr", { hasText: "Alpha Job" })).toBeVisible({ timeout: 10_000 });
    await expect(table.locator("tr", { hasText: "Beta Job" })).not.toBeVisible({ timeout: 5_000 });

    // Filter to "Disabled" only
    await selectOption(window, filterSelects.first(), "Disabled");
    await window.waitForTimeout(1_000);

    // Beta should be visible, Alpha should not
    await expect(table.locator("tr", { hasText: "Beta Job" })).toBeVisible({ timeout: 10_000 });
    await expect(table.locator("tr", { hasText: "Alpha Job" })).not.toBeVisible({ timeout: 5_000 });

    // Reset filter to "All"
    await selectOption(window, filterSelects.first(), "All");
    await window.waitForTimeout(1_000);

    // Both should be visible again
    await expect(table.locator("tr", { hasText: "Alpha Job" })).toBeVisible({ timeout: 10_000 });
    await expect(table.locator("tr", { hasText: "Beta Job" })).toBeVisible({ timeout: 10_000 });

    // Cleanup
    await deleteJob(window, "Alpha Job");
    await deleteJob(window, "Beta Job");
    await expect(window.locator(".empty-state")).toBeVisible({ timeout: 10_000 });
  });

  // ──────────────────────────────────────────────────────────
  // 10. Sort options
  // ──────────────────────────────────────────────────────────

  test("sort jobs by name", async ({ window }) => {
    await navigateToCrons(window);

    // Create two jobs
    await createIntervalJob(window, "Zebra Job", { intervalValue: "60", message: "Zebra msg" });
    await createIntervalJob(window, "Apple Job", { intervalValue: "60", message: "Apple msg" });

    // Wait for both to appear
    const table = window.locator(".crons-table");
    await expect(table.locator("tr", { hasText: "Apple Job" })).toBeVisible({ timeout: 10_000 });

    // Switch sort to "Name"
    const filterSelects = window.locator(".crons-filter-select .custom-select-trigger");
    await selectOption(window, filterSelects.nth(1), "Name");
    await window.waitForTimeout(1_000);

    // Verify both jobs exist and order
    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    // With ascending sort by name, Apple should come before Zebra
    const firstJobName = await rows.first().locator(".crons-job-name").textContent();
    const lastJobName = await rows.last().locator(".crons-job-name").textContent();
    expect(firstJobName).toBe("Apple Job");
    expect(lastJobName).toBe("Zebra Job");

    // Cleanup
    await deleteJob(window, "Apple Job");
    await deleteJob(window, "Zebra Job");
  });

  // ──────────────────────────────────────────────────────────
  // 11. Description field
  // ──────────────────────────────────────────────────────────

  test("job description displays in table and persists in edit", async ({ window }) => {
    await navigateToCrons(window);

    const modal = await openCreateForm(window);
    await fillName(modal, "Described Job");

    // Fill description (rows=2 textarea)
    const descTextarea = modal.locator("textarea[rows='2']");
    await descTextarea.fill("This is a detailed job description");

    // Set schedule
    const intervalBtn = modal.locator(".crons-schedule-type-btn", { hasText: "Interval" });
    await intervalBtn.click();
    await modal.locator("input[type='number']").fill("60");

    // Fill message (rows=3 textarea)
    await fillPayloadText(modal, "Description test message");

    await submitForm(modal);

    // Verify description appears in table
    const table = window.locator(".crons-table");
    const jobRow = table.locator("tr", { hasText: "Described Job" });
    await expect(jobRow).toBeVisible({ timeout: 10_000 });
    await expect(jobRow.locator(".crons-job-desc")).toContainText("This is a detailed job description");

    // Edit and verify description persists
    const editBtn = jobRow.locator(".btn", { hasText: "Edit" });
    await editBtn.click();

    const editModal = window.locator(".modal-backdrop");
    await expect(editModal).toBeVisible();

    // Description textarea should have the value
    const editDescTextarea = editModal.locator("textarea[rows='2']");
    await expect(editDescTextarea).toHaveValue("This is a detailed job description");

    // Cancel
    await editModal.locator(".modal-actions .btn-secondary", { hasText: "Cancel" }).click();
    await expect(editModal).toBeHidden({ timeout: 5_000 });

    // Cleanup
    await deleteJob(window, "Described Job");
  });

  // ──────────────────────────────────────────────────────────
  // 12. Cron expression presets
  // ──────────────────────────────────────────────────────────

  test("cron presets update expression preview", async ({ window }) => {
    await navigateToCrons(window);

    const modal = await openCreateForm(window);

    // Preset chips and their expected expressions
    const presets = [
      { label: "Every minute", expr: "* * * * *" },
      { label: "Every 5 min", expr: "*/5 * * * *" },
      { label: "Every 15 min", expr: "*/15 * * * *" },
      { label: "Every hour", expr: "0 * * * *" },
      { label: "Every day", expr: "0 0 * * *" },
      { label: "Monday 9am", expr: "0 9 * * 1" },
      { label: "1st of every month", expr: "0 0 1 * *" },
    ];

    for (const { label, expr } of presets) {
      const chip = modal.locator(".crons-preset-chip", { hasText: label });
      await chip.click();

      // Verify active state
      await expect(chip).toHaveClass(/crons-preset-chip-active/);

      // Verify expression bar
      await expect(modal.locator(".crons-expr-value")).toContainText(expr);
    }

    // Close modal without saving
    const cancelBtn = modal.locator(".modal-actions .btn-secondary", { hasText: "Cancel" });
    await cancelBtn.click();
    await expect(modal).toBeHidden({ timeout: 5_000 });
  });

  // ──────────────────────────────────────────────────────────
  // 13. Cron timezone selector
  // ──────────────────────────────────────────────────────────

  test("timezone select is searchable", async ({ window }) => {
    await navigateToCrons(window);

    const modal = await openCreateForm(window);

    // Select a cron preset so the form is valid
    const preset = modal.locator(".crons-preset-chip", { hasText: "Every hour" });
    await preset.click();

    // Find the timezone select and click to open dropdown
    const tzGroup = modal.locator(".form-group").filter({ hasText: "Timezone" });
    const tzTrigger = tzGroup.locator(".custom-select-trigger");

    // Click trigger and wait for the portal dropdown to appear
    await tzTrigger.click();
    const dropdown = window.locator(".custom-select-dropdown");

    // Retry trigger click if dropdown didn't appear (scroll/reposition race)
    if (!await dropdown.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await tzTrigger.click();
    }
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    // Verify search input exists (confirms searchable prop)
    await expect(dropdown.locator(".custom-select-search")).toBeVisible({ timeout: 3_000 });

    // Select Tokyo via DOM click (bypasses Playwright's scroll-into-view which
    // can detach the element when the portal dropdown is repositioning)
    await window.evaluate(() => {
      const opts = document.querySelectorAll<HTMLButtonElement>(".custom-select-dropdown .custom-select-option");
      for (const opt of opts) {
        if (opt.textContent?.includes("Tokyo")) { opt.click(); break; }
      }
    });

    // Verify selection
    await expect(tzTrigger).toContainText("Tokyo");

    // Close modal
    await modal.locator(".modal-actions .btn-secondary", { hasText: "Cancel" }).click();
    await expect(modal).toBeHidden({ timeout: 5_000 });
  });

  // ──────────────────────────────────────────────────────────
  // 14. Multiple jobs with status bar count
  // ──────────────────────────────────────────────────────────

  test("status bar shows job count", async ({ window }) => {
    await navigateToCrons(window);

    // Create a job
    await createIntervalJob(window, "Count Test Job", { intervalValue: "60", message: "Count test" });

    // Wait for table
    await expect(window.locator(".crons-table")).toBeVisible({ timeout: 10_000 });

    // Status bar should show job count
    const statusBar = window.locator(".crons-status-bar");
    await expect(statusBar).toContainText("1");

    // Cleanup
    await deleteJob(window, "Count Test Job");
  });

  // ──────────────────────────────────────────────────────────
  // 15. Edit preserves all schedule types
  // ──────────────────────────────────────────────────────────

  test("edit preserves interval schedule correctly", async ({ window }) => {
    await navigateToCrons(window);

    // Create an interval job with specific unit
    await createIntervalJob(window, "Interval Persist Job", { intervalValue: "2", unit: "Hours", message: "Interval persist test" });

    // Verify schedule in table
    const table = window.locator(".crons-table");
    const jobRow = table.locator("tr", { hasText: "Interval Persist Job" });
    await expect(jobRow).toBeVisible({ timeout: 10_000 });
    await expect(jobRow.locator(".crons-schedule-text")).toContainText("Every 2h");

    // Edit and verify schedule is preserved
    await jobRow.locator(".btn", { hasText: "Edit" }).click();
    const editModal = window.locator(".modal-backdrop");
    await expect(editModal).toBeVisible();

    // Interval should be active
    const editIntervalBtn = editModal.locator(".crons-schedule-type-btn", { hasText: "Interval" });
    await expect(editIntervalBtn).toHaveClass(/crons-schedule-type-btn-active/);

    // Value should be 2
    const editIntervalInput = editModal.locator("input[type='number']");
    await expect(editIntervalInput).toHaveValue("2");

    // Unit should be Hours
    const editUnitSelect = editModal.locator(".crons-form-row .custom-select-trigger");
    await expect(editUnitSelect).toContainText("Hours");

    // Cancel
    await editModal.locator(".modal-actions .btn-secondary", { hasText: "Cancel" }).click();
    await expect(editModal).toBeHidden({ timeout: 5_000 });

    // Cleanup
    await deleteJob(window, "Interval Persist Job");
  });

  // ──────────────────────────────────────────────────────────
  // 16. Cancel form does not create a job
  // ──────────────────────────────────────────────────────────

  test("cancelling the create form does not create a job", async ({ window }) => {
    await navigateToCrons(window);

    // Verify empty state
    await expect(window.locator(".empty-state")).toBeVisible({ timeout: 10_000 });

    // Open create form
    const modal = await openCreateForm(window);
    await fillName(modal, "Should Not Exist");

    // Cancel
    const cancelBtn = modal.locator(".modal-actions .btn-secondary", { hasText: "Cancel" });
    await cancelBtn.click();
    await expect(modal).toBeHidden({ timeout: 5_000 });

    // Still empty state
    await expect(window.locator(".empty-state")).toBeVisible({ timeout: 5_000 });
  });

  // ──────────────────────────────────────────────────────────
  // 17. Close form via backdrop click
  // ──────────────────────────────────────────────────────────

  test("close form by clicking modal backdrop", async ({ window }) => {
    await navigateToCrons(window);

    // Open create form
    const modal = await openCreateForm(window);
    await fillName(modal, "Backdrop Close Test");

    // Click outside modal content (top-left of backdrop)
    await modal.click({ position: { x: 5, y: 5 } });
    await expect(modal).toBeHidden({ timeout: 5_000 });

    // No job created
    await expect(window.locator(".empty-state")).toBeVisible({ timeout: 5_000 });
  });

  // ──────────────────────────────────────────────────────────
  // 18. Delete confirmation cancel
  // ──────────────────────────────────────────────────────────

  test("cancelling delete keeps the job", async ({ window }) => {
    await navigateToCrons(window);

    // Create a job
    await createIntervalJob(window, "Keep Me Job", { intervalValue: "60", message: "Keep me test" });

    const table = window.locator(".crons-table");
    const jobRow = table.locator("tr", { hasText: "Keep Me Job" });
    await expect(jobRow).toBeVisible({ timeout: 10_000 });

    // Click delete
    await jobRow.locator(".btn-danger", { hasText: "Delete" }).click();

    // Cancel the confirm dialog
    const confirmDialog = window.locator(".modal-backdrop");
    await expect(confirmDialog).toBeVisible();
    const cancelBtn = confirmDialog.locator(".btn", { hasText: "Cancel" });
    await cancelBtn.click();
    await expect(confirmDialog).toBeHidden({ timeout: 5_000 });

    // Job should still be there
    await expect(jobRow).toBeVisible();

    // Cleanup
    await deleteJob(window, "Keep Me Job");
  });

  // ──────────────────────────────────────────────────────────
  // 19. Run history modal for a job with no runs
  // ──────────────────────────────────────────────────────────

  test("history modal shows empty state for new job", async ({ window }) => {
    await navigateToCrons(window);

    // Create a job with long interval so it never runs
    await createIntervalJob(window, "History Empty Job", { intervalValue: "9999", unit: "Hours", message: "History empty test" });

    // Open history
    const table = window.locator(".crons-table");
    const jobRow = table.locator("tr", { hasText: "History Empty Job" });
    await expect(jobRow).toBeVisible({ timeout: 10_000 });

    await jobRow.locator(".btn", { hasText: "History" }).click();

    const historyModal = window.locator(".modal-backdrop");
    await expect(historyModal).toBeVisible();

    // Should show empty state
    await expect(historyModal.locator(".empty-state")).toBeVisible({ timeout: 10_000 });

    // Close
    await historyModal.locator(".modal-close-btn").click();
    await expect(historyModal).toBeHidden({ timeout: 5_000 });

    // Cleanup
    await deleteJob(window, "History Empty Job");
  });

  // ──────────────────────────────────────────────────────────
  // 20. Enabled checkbox default and toggle in form
  // ──────────────────────────────────────────────────────────

  test("create job with enabled unchecked", async ({ window }) => {
    await navigateToCrons(window);

    const modal = await openCreateForm(window);
    await fillName(modal, "Disabled Job");

    // Set interval schedule
    const intervalBtn = modal.locator(".crons-schedule-type-btn", { hasText: "Interval" });
    await intervalBtn.click();
    await modal.locator("input[type='number']").fill("60");

    // Fill message (rows=3 textarea)
    await fillPayloadText(modal, "Disabled test");

    // Uncheck enabled
    const enabledLabel = modal.locator(".crons-checkbox-label", { hasText: "Enabled" });
    const enabledCheckbox = enabledLabel.locator("input[type='checkbox']");
    await expect(enabledCheckbox).toBeChecked();
    await enabledLabel.click();
    await expect(enabledCheckbox).not.toBeChecked();

    await submitForm(modal);

    // Verify toggle is off in table
    const table = window.locator(".crons-table");
    const jobRow = table.locator("tr", { hasText: "Disabled Job" });
    await expect(jobRow).toBeVisible({ timeout: 10_000 });

    const toggle = jobRow.locator(".toggle-switch input[type='checkbox']");
    await expect(toggle).not.toBeChecked();

    // Cleanup
    await deleteJob(window, "Disabled Job");
  });
});

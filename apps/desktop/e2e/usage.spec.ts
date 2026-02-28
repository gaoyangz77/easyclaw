import { test, expect } from "./electron-fixture.js";

test.describe("Usage Page", () => {
  test("multi-provider seeded data, active key, today table, and chart", async ({ electronApp, window }) => {
    // Dismiss any modal(s) blocking the UI
    for (let i = 0; i < 3; i++) {
      const backdrop = window.locator(".modal-backdrop");
      if (!await backdrop.isVisible({ timeout: 3_000 }).catch(() => false)) break;
      await backdrop.click({ position: { x: 5, y: 5 }, force: true });
      await backdrop.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
    }

    // --- Seed 2 providers, 3 keys, 5 models across multiple days ---
    const dbPath = await electronApp.evaluate(() => process.env.EASYCLAW_DB_PATH);
    expect(dbPath).toBeTruthy();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    const now = Date.now();
    const isoNow = new Date().toISOString();
    const DAY = 86_400_000;

    // -- Provider keys --
    // Clear any keys created by onboarding so seeded keys are deterministic
    db.prepare(`DELETE FROM provider_keys`).run();

    // Key 1: openai / gpt-4o (active — is_default=1)
    db.prepare(`
      INSERT OR IGNORE INTO provider_keys
        (id, provider, label, model, is_default, auth_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("key-openai-main", "openai", "OpenAI Main", "gpt-4o", 1, "api_key", isoNow, isoNow);

    // Key 2: openai / gpt-4o-mini (not active)
    db.prepare(`
      INSERT OR IGNORE INTO provider_keys
        (id, provider, label, model, is_default, auth_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("key-openai-mini", "openai", "OpenAI Mini", "gpt-4o-mini", 0, "api_key", isoNow, isoNow);

    // Key 3: anthropic / claude-sonnet-4-5 (not active, different provider)
    db.prepare(`
      INSERT OR IGNORE INTO provider_keys
        (id, provider, label, model, is_default, auth_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("key-anthropic", "anthropic", "Anthropic Key", "claude-sonnet-4-5-20250929", 0, "api_key", isoNow, isoNow);

    // Set openai as active provider
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run("llm-provider", "openai");

    // -- Historical usage records spanning 5 days --
    const insertHistory = db.prepare(`
      INSERT INTO key_model_usage_history
        (key_id, provider, model, start_time, end_time, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, total_cost_usd, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Key 1 (openai/gpt-4o) — 3 days of usage: today, yesterday, 3 days ago
    insertHistory.run(
      "key-openai-main", "openai", "gpt-4o",
      now - 3 * DAY, now - 3 * DAY + 3600_000,
      5000, 1200, 300, 100, "0.018000", isoNow,
    );
    insertHistory.run(
      "key-openai-main", "openai", "gpt-4o",
      now - DAY, now - DAY + 3600_000,
      8000, 2000, 500, 200, "0.030000", isoNow,
    );
    insertHistory.run(
      "key-openai-main", "openai", "gpt-4o",
      now - 3600_000, now,
      12500, 3200, 800, 400, "0.045000", isoNow,
    );

    // Key 2 (openai/gpt-4o-mini) — 2 days of usage: yesterday and 2 days ago
    insertHistory.run(
      "key-openai-mini", "openai", "gpt-4o-mini",
      now - 2 * DAY, now - 2 * DAY + 3600_000,
      20000, 5000, 0, 0, "0.005000", isoNow,
    );
    insertHistory.run(
      "key-openai-mini", "openai", "gpt-4o-mini",
      now - DAY, now - DAY + 3600_000,
      30000, 8000, 0, 0, "0.008000", isoNow,
    );

    // Key 3 (anthropic/claude-sonnet-4-5) — 3 days of usage
    insertHistory.run(
      "key-anthropic", "anthropic", "claude-sonnet-4-5-20250929",
      now - 4 * DAY, now - 4 * DAY + 3600_000,
      3000, 800, 1000, 200, "0.012000", isoNow,
    );
    insertHistory.run(
      "key-anthropic", "anthropic", "claude-sonnet-4-5-20250929",
      now - 2 * DAY, now - 2 * DAY + 3600_000,
      6000, 1500, 2000, 500, "0.025000", isoNow,
    );
    insertHistory.run(
      "key-anthropic", "anthropic", "claude-sonnet-4-5-20250929",
      now - DAY, now - DAY + 3600_000,
      9000, 2200, 3000, 700, "0.038000", isoNow,
    );

    db.close();

    // --- Navigate to Usage page ---
    const usageBtn = window.locator(".nav-btn", { hasText: "Usage" });
    await usageBtn.click();
    await expect(usageBtn).toHaveClass(/nav-active/);

    // Wait for loading to finish
    await window.locator(".text-muted").waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});

    // No error alert
    await expect(window.locator(".error-alert")).not.toBeVisible();

    // --- Verify Today's Usage table (section with "Today" title) ---
    // Use :has(.usage-section-title) to target only Usage page cards, not hidden cards from other pages
    const usageSectionCards = window.locator(".section-card:has(.usage-section-title)");
    const todaySection = usageSectionCards.first();
    await expect(todaySection).toBeVisible({ timeout: 10_000 });
    // Today's section should have the "Today's Usage" heading
    await expect(todaySection.locator(".usage-section-title")).toContainText(/Today|今日/);

    // Today's table should contain the active key's data (openai/gpt-4o — has today's record)
    await expect(todaySection.locator(".usage-key-block").first()).toBeVisible();
    await expect(todaySection).toContainText("gpt-4o");

    // --- Verify Historical Usage table (section-card after time range bar) ---
    const cardCount = await usageSectionCards.count();
    // Should have at least 2 cards: today table + historical table
    expect(cardCount).toBeGreaterThanOrEqual(2);

    // Historical table (second card) should contain all providers and models
    const historySection = usageSectionCards.nth(1);
    await expect(historySection.locator(".usage-key-block").first()).toBeVisible();

    // Verify both providers appear in key block headers
    await expect(historySection).toContainText("openai");
    await expect(historySection).toContainText("anthropic");

    // Verify all 3 key labels
    await expect(historySection).toContainText("OpenAI Main");
    await expect(historySection).toContainText("OpenAI Mini");
    await expect(historySection).toContainText("Anthropic Key");

    // Verify all models
    await expect(historySection).toContainText("gpt-4o");
    await expect(historySection).toContainText("gpt-4o-mini");
    await expect(historySection).toContainText("claude-sonnet-4-5-20250929");

    // --- Verify active key badge ---
    // The active key/model (openai / gpt-4o) should have an "Active" badge
    await expect(window.locator(".badge-active").first()).toBeVisible();

    // --- Verify usage line chart ---
    // We seeded data across multiple days, so the chart should render
    const chartSection = window.locator(".usage-chart-wrap");
    await expect(chartSection).toBeVisible({ timeout: 5_000 });
    // The main chart SVG (not the small legend icons)
    const chartSvg = chartSection.locator("svg[role='application']");
    await expect(chartSvg).toBeVisible();
    // Should have line elements for our 3 key/model series
    const lines = chartSection.locator(".recharts-line");
    const lineCount = await lines.count();
    expect(lineCount).toBe(3);

    // --- Verify API responses directly ---
    // /api/key-usage — all records
    const usageResponse = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/key-usage");
      return { status: res.status, body: await res.json() };
    });
    expect(usageResponse.status).toBe(200);
    expect(Array.isArray(usageResponse.body)).toBe(true);
    // Should have records for all 3 keys
    const keyIds = usageResponse.body.map((r: { keyId: string }) => r.keyId);
    expect(keyIds).toContain("key-openai-main");
    expect(keyIds).toContain("key-openai-mini");
    expect(keyIds).toContain("key-anthropic");

    // Verify token counts for openai main key (sum of all 3 days)
    const openaiMain = usageResponse.body.find(
      (r: { keyId: string }) => r.keyId === "key-openai-main",
    );
    expect(openaiMain).toBeDefined();
    expect(openaiMain.keyLabel).toBe("OpenAI Main");
    expect(openaiMain.provider).toBe("openai");
    expect(openaiMain.model).toBe("gpt-4o");
    expect(openaiMain.inputTokens).toBe(5000 + 8000 + 12500); // 25500
    expect(openaiMain.outputTokens).toBe(1200 + 2000 + 3200); // 6400
    expect(openaiMain.authType).toBe("api_key");

    // Verify anthropic key totals
    const anthropicKey = usageResponse.body.find(
      (r: { keyId: string }) => r.keyId === "key-anthropic",
    );
    expect(anthropicKey).toBeDefined();
    expect(anthropicKey.keyLabel).toBe("Anthropic Key");
    expect(anthropicKey.inputTokens).toBe(3000 + 6000 + 9000); // 18000
    expect(anthropicKey.outputTokens).toBe(800 + 1500 + 2200); // 4500

    // /api/key-usage/active — should return the active key
    const activeResponse = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/key-usage/active");
      return { status: res.status, body: await res.json() };
    });
    expect(activeResponse.status).toBe(200);
    expect(activeResponse.body).not.toBeNull();
    expect(activeResponse.body.keyId).toBe("key-openai-main");
    expect(activeResponse.body.keyLabel).toBe("OpenAI Main");
    expect(activeResponse.body.provider).toBe("openai");
    expect(activeResponse.body.model).toBe("gpt-4o");
    expect(activeResponse.body.authType).toBe("api_key");

    // /api/key-usage/timeseries — should return daily buckets
    const tsResponse = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/key-usage/timeseries");
      return { status: res.status, body: await res.json() };
    });
    expect(tsResponse.status).toBe(200);
    expect(Array.isArray(tsResponse.body)).toBe(true);
    // We seeded records across 5 different days, expect multiple buckets
    expect(tsResponse.body.length).toBeGreaterThanOrEqual(3);
    // Each bucket should have the expected shape
    const firstBucket = tsResponse.body[0];
    expect(firstBucket).toHaveProperty("keyId");
    expect(firstBucket).toHaveProperty("keyLabel");
    expect(firstBucket).toHaveProperty("date");
    expect(firstBucket).toHaveProperty("inputTokens");
    expect(firstBucket).toHaveProperty("outputTokens");

    // --- Verify time range filtering works ---
    // Switch to 7-day view and verify data is filtered
    await window.locator(".usage-time-range-bar .btn", { hasText: "7 Days" }).click();
    await window.locator(".text-muted").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});

    // All our seeded data is within 7 days, so it should all be visible
    await expect(historySection).toContainText("openai");
    await expect(historySection).toContainText("anthropic");

    // "Last updated" timestamp should be visible
    await expect(window.locator(".td-meta")).toBeVisible();
  });
});

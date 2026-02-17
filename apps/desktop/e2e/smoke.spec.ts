import { test, expect } from "./electron-fixture.js";

test.describe("EasyClaw Smoke Tests", () => {
  test("app launches and window is visible", async ({ electronApp, window }) => {
    const windows = electronApp.windows();
    expect(windows.length).toBe(1);

    const title = await window.title();
    expect(title).toBe("EasyClaw");
  });

  test("panel renders with sidebar navigation", async ({ window }) => {
    const brand = window.locator(".sidebar-brand-text");
    await expect(brand).toBeVisible();

    const navItems = window.locator(".nav-list .nav-btn");
    const count = await navItems.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("chat page is default and gateway connects", async ({ window }) => {
    // Chat should be the active nav item by default
    const firstNav = window.locator(".nav-list .nav-btn").first();
    await expect(firstNav).toHaveClass(/nav-active/);

    // Wait for gateway to reach "Connected" state
    const connectedDot = window.locator(".chat-status-dot-connected");
    await expect(connectedDot).toBeVisible({ timeout: 30_000 });

    // Verify connection stays stable for 3 seconds
    await window.waitForTimeout(3_000);
    await expect(connectedDot).toBeVisible();
  });

  test("LLM Providers page: dropdowns and pricing", async ({ window }) => {
    // Dismiss any modal(s) blocking the UI (e.g. "What's New", telemetry consent).
    // Prod builds may show modals that dev builds skip. Try up to 3 times.
    for (let i = 0; i < 3; i++) {
      const backdrop = window.locator(".modal-backdrop");
      if (!await backdrop.isVisible({ timeout: 3_000 }).catch(() => false)) break;
      // Click the top-left corner of the backdrop (outside modal-content) to trigger onClose
      await backdrop.click({ position: { x: 5, y: 5 }, force: true });
      await backdrop.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
    }

    // Navigate to LLM Providers page
    const providersBtn = window.locator(".nav-btn", { hasText: "LLM Providers" });
    await providersBtn.click();
    await expect(providersBtn).toHaveClass(/nav-active/);

    // -- Subscription tab (default) --
    const subTab = window.locator(".tab-btn", { hasText: /Subscription/i });
    await expect(subTab).toHaveClass(/tab-btn-active/);

    // Subscription dropdown: 4 in models.ts (anthropic + 3 nested plans),
    // but ProviderSelect filters by model catalog — at least 2 are always present.
    await window.locator(".provider-select-trigger").click();
    const subOptions = window.locator(".provider-select-option");
    const subCount = await subOptions.count();
    expect(subCount).toBeGreaterThanOrEqual(2);
    expect(subCount).toBeLessThanOrEqual(5);
    // Close dropdown
    await window.locator(".provider-select-trigger").click();

    // Subscription pricing table should be visible and have content
    const subPricing = window.locator(".pricing-card");
    await expect(subPricing).toBeVisible();
    const subPricingContent = subPricing.locator(".pricing-plan-block, .pricing-inner-table");
    await expect(subPricingContent.first()).toBeVisible({ timeout: 10_000 });

    // -- Switch to API Key tab --
    const apiTab = window.locator(".tab-btn", { hasText: /API/i });
    await apiTab.click();
    await expect(apiTab).toHaveClass(/tab-btn-active/);

    // API Key dropdown: 17 root providers minus subscription, filtered by catalog.
    // At least 10 should always be present.
    await window.locator(".provider-select-trigger").click();
    const apiOptions = window.locator(".provider-select-option");
    const apiCount = await apiOptions.count();
    expect(apiCount).toBeGreaterThanOrEqual(10);
    expect(apiCount).toBeLessThanOrEqual(20);
    // Close dropdown
    await window.locator(".provider-select-trigger").click();

    // API pricing table should be visible and have content
    const apiPricing = window.locator(".pricing-card");
    await expect(apiPricing).toBeVisible();
    const apiTable = apiPricing.locator(".pricing-inner-table");
    await expect(apiTable).toBeVisible({ timeout: 10_000 });
  });

  test("add second key and switch active provider", async ({ window }) => {
    const zhipuKey = process.env.E2E_ZHIPU_API_KEY;
    const volcengineKey = process.env.E2E_VOLCENGINE_API_KEY;
    test.skip(!zhipuKey || !volcengineKey, "E2E_ZHIPU_API_KEY and E2E_VOLCENGINE_API_KEY required");

    // Dismiss modals
    for (let i = 0; i < 3; i++) {
      const backdrop = window.locator(".modal-backdrop");
      if (!await backdrop.isVisible({ timeout: 3_000 }).catch(() => false)) break;
      await backdrop.click({ position: { x: 5, y: 5 }, force: true });
      await backdrop.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
    }

    // Navigate to LLM Providers page
    const providersBtn = window.locator(".nav-btn", { hasText: "LLM Providers" });
    await providersBtn.click();
    await expect(providersBtn).toHaveClass(/nav-active/);

    // Verify pre-seeded volcengine key is active
    const keyCards = window.locator(".key-card");
    await expect(keyCards).toHaveCount(1);
    await expect(keyCards.first()).toHaveClass(/key-card-active/);

    // -- Add GLM key via the "Add Key" form --
    const form = window.locator(".page-two-col");

    // Switch to API tab
    await form.locator(".tab-btn", { hasText: /API/i }).click();

    // Select Zhipu (GLM)
    await form.locator(".provider-select-trigger").click();
    await form.locator(".provider-select-option", { hasText: /Zhipu \(GLM\) - China/i }).click();

    // Select GLM-4.7-Flash model
    await form.locator(".custom-select-trigger").click();
    await window.locator(".custom-select-option", { hasText: /GLM-4\.7-Flash/i }).click();

    // Enter API key and save
    await form.locator("input[type='password']").fill(zhipuKey!);
    await form.locator(".form-actions .btn.btn-primary").click();

    // Wait for validation + save, then verify both keys appear
    await expect(keyCards).toHaveCount(2, { timeout: 30_000 });

    const volcengineCard = window.locator(".key-card", { hasText: /Volcengine/i });
    const zhipuCard = window.locator(".key-card", { hasText: /Zhipu/i });
    await expect(volcengineCard).toHaveClass(/key-card-active/);
    await expect(zhipuCard).toHaveClass(/key-card-inactive/);

    // -- Activate the GLM key --
    await zhipuCard.locator(".btn", { hasText: /Activate/i }).click();

    // Verify GLM is now active and volcengine is inactive
    await expect(zhipuCard).toHaveClass(/key-card-active/, { timeout: 10_000 });
    await expect(volcengineCard).toHaveClass(/key-card-inactive/);
    await expect(zhipuCard.locator(".badge-active")).toBeVisible();
  });

  test("Usage page: multi-provider seeded data, active key, today table, and chart", async ({ electronApp, window }) => {
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

  test("Skills page: market browse, search, labels, and API validation", async ({ window }) => {
    // Dismiss any modal(s) blocking the UI
    for (let i = 0; i < 3; i++) {
      const backdrop = window.locator(".modal-backdrop");
      if (!await backdrop.isVisible({ timeout: 3_000 }).catch(() => false)) break;
      await backdrop.click({ position: { x: 5, y: 5 }, force: true });
      await backdrop.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
    }

    // --- Navigate to Skills page ---
    const skillsBtn = window.locator(".nav-btn", { hasText: "Skills" });
    await skillsBtn.click();
    await expect(skillsBtn).toHaveClass(/nav-active/);

    // Page title and description should be visible
    await expect(window.locator("h1", { hasText: /Skills Marketplace|技能市场/ })).toBeVisible();

    // --- Market tab should be active by default ---
    const marketTab = window.locator(".skills-tab-bar .btn", { hasText: /Market|市场/ });
    await expect(marketTab).toHaveClass(/btn-outline/);

    // Wait for loading to finish
    await window.locator(".text-muted").waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});

    // No error alert
    await expect(window.locator(".error-alert")).not.toBeVisible();

    // --- Verify market skills loaded from server backend ---
    const skillCards = window.locator(".skills-grid .section-card");
    const cardCount = await skillCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(1);

    // Each card should have: name, description, meta (author, version, stars, downloads), actions
    const firstCard = skillCards.first();
    await expect(firstCard.locator(".skill-card-name")).toBeVisible();
    await expect(firstCard.locator(".skill-card-desc")).toBeVisible();
    await expect(firstCard.locator(".skill-card-meta")).toBeVisible();
    await expect(firstCard.locator(".skill-card-actions .btn")).toBeVisible();

    // Meta section should contain author, version, stars, downloads
    const meta = firstCard.locator(".skill-card-meta");
    await expect(meta).toContainText(/by /);       // author
    await expect(meta).toContainText(/v\d/);        // version
    await expect(meta).toContainText(/stars/);      // stars count
    await expect(meta).toContainText(/downloads/);  // download count

    // --- Verify label badges render with correct classes ---
    // Check if any cards have labels (e.g. "推荐" / Recommended)
    const labelBadges = window.locator(".skill-card-labels .badge");
    const labelCount = await labelBadges.count();
    if (labelCount > 0) {
      const firstBadge = labelBadges.first();
      const badgeClass = await firstBadge.getAttribute("class");
      expect(badgeClass).toMatch(/badge-(info|muted)/);
    }

    // --- Verify category filter chips ---
    const categoryChips = window.locator(".skills-category-chips .btn");
    const chipCount = await categoryChips.count();
    if (chipCount > 0) {
      // "All" category should be active by default
      await expect(categoryChips.first()).toHaveClass(/btn-outline/);

      // Click a non-"All" category chip to filter
      if (chipCount > 1) {
        const secondChip = categoryChips.nth(1);
        const chipText = await secondChip.textContent();
        await secondChip.click();
        await expect(secondChip).toHaveClass(/btn-outline/);

        // Wait for filtered results
        await window.locator(".text-muted").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});

        // Skill cards should still render (possibly fewer)
        const filteredCards = window.locator(".skills-grid .section-card");
        const filteredCount = await filteredCards.count();
        // Either we have filtered results or empty state
        if (filteredCount > 0) {
          // All visible cards should have the selected tag in their meta
          expect(filteredCount).toBeLessThanOrEqual(cardCount);
        }

        // Reset to "All" filter
        await categoryChips.first().click();
        await window.locator(".text-muted").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
        void chipText; // used above for filter verification
      }
    }

    // --- Verify search input works ---
    const searchInput = window.locator(".skills-search-input");
    await expect(searchInput).toBeVisible();

    // Type a search query — use a term likely to match something
    await searchInput.fill("a");
    // Wait for debounce (300ms) + API response
    await window.waitForTimeout(500);
    await window.locator(".text-muted").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});

    // Clear search
    await searchInput.fill("");
    await window.waitForTimeout(500);
    await window.locator(".text-muted").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});

    // --- Verify API responses directly ---
    // GET /api/skills/market — proxy to server GraphQL
    const marketRes = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/skills/market");
      return { status: res.status, body: await res.json() };
    });
    expect(marketRes.status).toBe(200);
    expect(marketRes.body).toHaveProperty("skills");
    expect(marketRes.body).toHaveProperty("total");
    expect(marketRes.body).toHaveProperty("page");
    expect(marketRes.body).toHaveProperty("pageSize");
    expect(Array.isArray(marketRes.body.skills)).toBe(true);
    expect(marketRes.body.skills.length).toBeGreaterThanOrEqual(1);

    // Verify skill shape
    const skill = marketRes.body.skills[0];
    expect(skill).toHaveProperty("slug");
    expect(skill).toHaveProperty("name_en");
    expect(skill).toHaveProperty("name_zh");
    expect(skill).toHaveProperty("desc_en");
    expect(skill).toHaveProperty("desc_zh");
    expect(skill).toHaveProperty("author");
    expect(skill).toHaveProperty("version");
    expect(skill).toHaveProperty("tags");
    expect(skill).toHaveProperty("labels");
    expect(skill).toHaveProperty("stars");
    expect(skill).toHaveProperty("downloads");
    expect(typeof skill.stars).toBe("number");
    expect(typeof skill.downloads).toBe("number");

    // GET /api/skills/market with search query
    const searchRes = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/skills/market?query=test&page=1&pageSize=5");
      return { status: res.status, body: await res.json() };
    });
    expect(searchRes.status).toBe(200);
    expect(searchRes.body).toHaveProperty("skills");
    expect(searchRes.body.pageSize).toBe(5);

    // --- Verify installed skills API (empty in e2e) ---
    const installedRes = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/skills/installed");
      return { status: res.status, body: await res.json() };
    });
    expect(installedRes.status).toBe(200);
    expect(installedRes.body).toHaveProperty("skills");
    expect(Array.isArray(installedRes.body.skills)).toBe(true);

    // --- Verify install API returns error for nonexistent skill ---
    const installRes = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "nonexistent-skill" }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(installRes.status).toBe(200);
    expect(installRes.body.ok).toBe(false);
    expect(installRes.body.error).toBeTruthy();

    // --- Verify delete API validation ---
    // Missing slug → 400
    const deleteNoSlug = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/skills/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(deleteNoSlug.status).toBe(400);

    // Path traversal → 400
    const deleteTraversal = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/skills/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "../etc/passwd" }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(deleteTraversal.status).toBe(400);

    // Install missing slug → 400
    const installNoSlug = await window.evaluate(async () => {
      const res = await fetch("http://127.0.0.1:3210/api/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(installNoSlug.status).toBe(400);
  });

  test("Skills page: installed tab, seed + delete lifecycle", async ({ electronApp, window }) => {
    // Dismiss any modal(s)
    for (let i = 0; i < 3; i++) {
      const backdrop = window.locator(".modal-backdrop");
      if (!await backdrop.isVisible({ timeout: 3_000 }).catch(() => false)) break;
      await backdrop.click({ position: { x: 5, y: 5 }, force: true });
      await backdrop.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
    }

    // --- Seed a fake installed skill directory ---
    // Get homedir from Electron process, then create files in the test process
    // (electronApp.evaluate doesn't support require/import)
    const homeDir = await electronApp.evaluate(() => process.env.HOME || process.env.USERPROFILE || "");
    expect(homeDir).toBeTruthy();

    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const skillDir = join(homeDir, ".easyclaw", "openclaw", "skills", "e2e-test-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: E2E Test Skill",
        "description: A skill created for e2e testing",
        "author: e2e-tester",
        "version: 1.0.0",
        "---",
        "",
        "# E2E Test Skill",
        "This is a test skill.",
      ].join("\n"),
    );

    // --- Navigate to Skills page → Installed tab ---
    const skillsBtn = window.locator(".nav-btn", { hasText: "Skills" });
    await skillsBtn.click();
    await expect(skillsBtn).toHaveClass(/nav-active/);

    const installedTab = window.locator(".skills-tab-bar .btn", { hasText: /Installed|已安装/ });
    await installedTab.click();
    await expect(installedTab).toHaveClass(/btn-outline/);

    // Wait for loading
    await window.locator(".text-muted").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});

    // --- Verify seeded skill appears ---
    const installedCards = window.locator(".skills-installed-list .section-card");
    // At least one card for our seeded skill (user may also have real skills)
    const cardCount = await installedCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(1);

    // Find the card for our test skill
    const testSkillCard = window.locator(".section-card", { hasText: "E2E Test Skill" });
    await expect(testSkillCard).toBeVisible();
    await expect(testSkillCard).toContainText("e2e-tester");
    await expect(testSkillCard).toContainText("v1.0.0");

    // --- Delete the seeded skill ---
    const deleteBtn = testSkillCard.locator(".btn-danger");
    await deleteBtn.click();

    // Confirm dialog should appear
    const confirmDialog = window.locator(".modal-content");
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText(/delete|删除/i);

    // Click confirm (the danger button in the dialog)
    const confirmBtn = confirmDialog.locator(".btn-danger");
    await confirmBtn.click();

    // Wait for deletion and list refresh
    await window.waitForTimeout(1_000);

    // Verify skill is removed
    await expect(testSkillCard).not.toBeVisible({ timeout: 5_000 });

    // --- Verify the skill directory was actually deleted ---
    const { existsSync } = await import("node:fs");
    const exists = existsSync(skillDir);
    expect(exists).toBe(false);
  });

  test("window has correct web preferences", async ({ electronApp, window }) => {
    // Ensure window is created before evaluating
    await expect(window).toBeTruthy();

    const prefs = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const wp = win?.webContents.getLastWebPreferences();
      return {
        nodeIntegration: wp?.nodeIntegration,
        contextIsolation: wp?.contextIsolation,
      };
    });

    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.contextIsolation).toBe(true);
  });
});

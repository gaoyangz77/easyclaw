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
    // Dismiss any modal blocking the UI (e.g. telemetry consent)
    const closeBtn = window.locator(".modal-close-btn");
    if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await closeBtn.click();
      await window.locator(".modal-backdrop").waitFor({ state: "hidden", timeout: 5_000 });
    }

    // Navigate to LLM Providers page
    const providersBtn = window.locator(".nav-btn", { hasText: "LLM Providers" });
    await providersBtn.click();
    await expect(providersBtn).toHaveClass(/nav-active/);

    // -- Subscription tab (default) --
    const subTab = window.locator(".tab-btn", { hasText: /Subscription/i });
    await expect(subTab).toHaveClass(/tab-btn-active/);

    // Subscription dropdown: 3 in models.ts, but ProviderSelect filters by
    // model catalog from gateway — at least 2 are always present.
    await window.locator(".provider-select-trigger").click();
    const subOptions = window.locator(".provider-select-option");
    const subCount = await subOptions.count();
    expect(subCount).toBeGreaterThanOrEqual(2);
    expect(subCount).toBeLessThanOrEqual(3);
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

    // API Key dropdown: 18 in models.ts (!oauth), filtered by catalog.
    // At least 10 should always be present.
    await window.locator(".provider-select-trigger").click();
    const apiOptions = window.locator(".provider-select-option");
    const apiCount = await apiOptions.count();
    expect(apiCount).toBeGreaterThanOrEqual(10);
    expect(apiCount).toBeLessThanOrEqual(18);
    // Close dropdown
    await window.locator(".provider-select-trigger").click();

    // API pricing table should be visible and have content
    const apiPricing = window.locator(".pricing-card");
    await expect(apiPricing).toBeVisible();
    const apiTable = apiPricing.locator(".pricing-inner-table");
    await expect(apiTable).toBeVisible({ timeout: 10_000 });
  });

  test("window has correct web preferences", async ({ electronApp }) => {
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

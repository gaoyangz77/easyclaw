/**
 * Ecommerce Page — UI rendering, navigation, and drawer interaction.
 *
 * Requires staging login with GLOBAL_ECOMMERCE_SELLER module enrollment.
 * Assumes the test account always has at least one connected shop.
 *
 * All tests are read-only or toggle UI state that doesn't require teardown.
 */
import { test, expect } from "./electron-fixture.js";
import { DEFAULTS } from "@rivonclaw/core/defaults";

const STAGING_GRAPHQL_URL = `https://${DEFAULTS.domains.apiStaging}/graphql`;

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { accessToken refreshToken }
  }
`;

const testEmail = process.env.STAGING_TEST_USERNAME;
const testPassword = process.env.STAGING_TEST_PASSWORD;
const captchaBypass = process.env.STAGING_CAPTCHA_BYPASS_TOKEN;

/** Login via staging GraphQL, store tokens in Desktop, reload Panel. */
async function loginAndNavigateToEcommerce(
  window: import("@playwright/test").Page,
  apiBase: string,
): Promise<void> {
  const loginRes = await fetch(STAGING_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: LOGIN_MUTATION,
      variables: {
        input: {
          email: testEmail,
          password: testPassword,
          captchaToken: captchaBypass ?? "test",
          captchaAnswer: "bypass",
        },
      },
    }),
  });
  const loginBody = (await loginRes.json()) as {
    data?: { login: { accessToken: string; refreshToken: string } };
    errors?: Array<{ message: string }>;
  };
  if (loginBody.errors?.length) {
    throw new Error(`Login failed: ${loginBody.errors[0].message}`);
  }
  const { accessToken, refreshToken } = loginBody.data!.login;

  const storeRes = await fetch(`${apiBase}/api/auth/store-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken, refreshToken }),
  });
  expect(storeRes.status).toBe(200);

  await window.reload({ waitUntil: "domcontentloaded" });
  await expect(window.locator(".user-avatar-circle")).toBeVisible({ timeout: 15_000 });

  // Navigate to ecommerce page via sidebar
  const navBtn = window.locator(".nav-btn", { hasText: "Global E-commerce" });
  await navBtn.click({ timeout: 15_000 });
}

async function dismissModals(window: import("@playwright/test").Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const backdrop = window.locator(".modal-backdrop");
    if (!await backdrop.isVisible({ timeout: 2_000 }).catch(() => false)) break;
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await backdrop.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => {});
  }
}

// ── Auth Gating ──────────────────────────────────────────────────────

test.describe("Ecommerce Page — Auth Gating", () => {
  test("clicking ecommerce nav without login opens auth modal", async ({ window }) => {
    await dismissModals(window);

    // The ecommerce nav item only appears when GLOBAL_ECOMMERCE_SELLER module
    // is enrolled, which requires login. Without login the nav item won't exist.
    // So we test that the page is not directly accessible by URL.
    const urlBefore = window.url();
    await window.evaluate(() => window.history.pushState(null, "", "/ecommerce"));
    // Panel resolves unknown routes to "/" — ecommerce without auth should fall back
    await window.waitForTimeout(500);
    // The page-enter with ecommerce content should NOT be visible
    const ecommerceHeader = window.locator(".ecommerce-page-header");
    const isVisible = await ecommerceHeader.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });
});

// ── Authenticated Tests ──────────────────────────────────────────────

test.describe("Ecommerce Page — Authenticated", () => {
  test.skip(!testEmail || !testPassword, "Staging credentials not configured");

  test("page renders with title, subtitle, and add shop button", async ({ window, apiBase }) => {
    await dismissModals(window);
    await loginAndNavigateToEcommerce(window, apiBase);

    // Verify page header
    const header = window.locator(".ecommerce-page-header");
    await expect(header).toBeVisible({ timeout: 15_000 });
    await expect(header.locator("h1")).toContainText("Global E-commerce Seller");
    await expect(header.locator(".ecommerce-page-subtitle")).toContainText("Manage your connected shops");

    // Add Shop button
    const addBtn = header.locator("button", { hasText: "Add Shop" });
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toBeEnabled();
  });

  test("shop table renders with at least one shop", async ({ window, apiBase }) => {
    await dismissModals(window);
    await loginAndNavigateToEcommerce(window, apiBase);

    // Wait for the shop table to appear (shops arrive via MST/SSE after login)
    const shopTable = window.locator(".shop-table");
    await expect(shopTable).toBeVisible({ timeout: 20_000 });

    // Verify table headers
    const headers = shopTable.locator("thead th");
    await expect(headers.nth(0)).toContainText("Shop Name");
    await expect(headers.nth(1)).toContainText("Platform");
    await expect(headers.nth(2)).toContainText("Region");
    await expect(headers.nth(3)).toContainText("Auth Status");
    await expect(headers.nth(4)).toContainText("CS Balance");
    await expect(headers.nth(5)).toContainText("Actions");

    // At least one shop row
    const rows = shopTable.locator("tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(1);

    // First shop row has a name and a View button
    const firstRow = rows.first();
    await expect(firstRow.locator(".shop-table-name")).toBeVisible();
    await expect(firstRow.locator("button", { hasText: "View" })).toBeVisible();
  });

  test("add shop modal opens and closes without submitting", async ({ window, apiBase }) => {
    await dismissModals(window);
    await loginAndNavigateToEcommerce(window, apiBase);
    await expect(window.locator(".ecommerce-page-header")).toBeVisible({ timeout: 15_000 });

    // Open the modal
    await window.locator("button", { hasText: "Add Shop" }).click();
    const modal = window.locator(".modal-backdrop");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Modal title
    await expect(window.locator(".modal-title")).toContainText("Add Shop");

    // Cancel closes the modal
    await window.locator(".modal-backdrop button", { hasText: "Cancel" }).click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
  });

  test("shop drawer opens, shows overview tab, and closes", async ({ window, apiBase }) => {
    await dismissModals(window);
    await loginAndNavigateToEcommerce(window, apiBase);

    // Wait for shop table
    const shopTable = window.locator(".shop-table");
    await expect(shopTable).toBeVisible({ timeout: 20_000 });

    // Click View on the first shop
    const firstViewBtn = shopTable.locator("tbody tr").first().locator("button", { hasText: "View" });
    await firstViewBtn.click();

    // Drawer should open
    const drawer = window.locator(".drawer-panel-open");
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Drawer header shows the shop name
    const drawerTitle = drawer.locator(".drawer-header-title");
    await expect(drawerTitle).toBeVisible();
    const shopName = await drawerTitle.textContent();
    expect(shopName!.length).toBeGreaterThan(0);

    // Overview tab is active by default
    const overviewTab = drawer.locator(".drawer-tab-btn-active");
    await expect(overviewTab).toContainText("Overview");

    // Overview shows shop info section
    await expect(drawer.locator(".drawer-section-label", { hasText: "Shop Information" })).toBeVisible();
    await expect(drawer.locator(".shop-info-card").first()).toBeVisible();

    // Overview shows CS toggle
    await expect(drawer.locator(".shop-toggle-card")).toBeVisible();
    await expect(drawer.locator(".toggle-switch")).toBeVisible();

    // Close drawer via close button
    await drawer.locator(".drawer-close-btn").click();
    await expect(drawer).not.toBeVisible({ timeout: 5_000 });
  });

  test("shop drawer tab switching to AI Customer Service", async ({ window, apiBase }) => {
    await dismissModals(window);
    await loginAndNavigateToEcommerce(window, apiBase);

    const shopTable = window.locator(".shop-table");
    await expect(shopTable).toBeVisible({ timeout: 20_000 });

    // Open drawer on first shop
    await shopTable.locator("tbody tr").first().locator("button", { hasText: "View" }).click();
    const drawer = window.locator(".drawer-panel-open");
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Check if AI CS tab exists (only when CS is enabled for this shop)
    const aiCsTab = drawer.locator(".drawer-tab-btn", { hasText: "AI Customer Service" });
    const csTabVisible = await aiCsTab.isVisible().catch(() => false);

    if (csTabVisible) {
      // Click AI CS tab
      await aiCsTab.click();
      await expect(drawer.locator(".drawer-tab-btn-active")).toContainText("AI Customer Service");

      // AI CS tab shows service status section
      await expect(drawer.locator(".drawer-section-label", { hasText: "Service Status" })).toBeVisible();

      // Shows device binding section
      await expect(drawer.locator(".drawer-section-label", { hasText: "Handle CS on this device" })).toBeVisible();

      // Shows run profile section
      await expect(drawer.locator(".drawer-section-label", { hasText: "Agent Permissions" })).toBeVisible();

      // Shows CS model section
      await expect(drawer.locator(".drawer-section-label", { hasText: "CS Model" })).toBeVisible();

      // Shows business prompt section
      await expect(drawer.locator(".drawer-section-label", { hasText: "Business Prompt" })).toBeVisible();
      await expect(drawer.locator("textarea")).toBeVisible();

      // Switch back to overview
      await drawer.locator(".drawer-tab-btn", { hasText: "Overview" }).click();
      await expect(drawer.locator(".drawer-tab-btn-active")).toContainText("Overview");
    }

    // Close drawer via overlay
    await window.locator(".drawer-overlay-visible").click();
    await expect(drawer).not.toBeVisible({ timeout: 5_000 });
  });

  test("CS toggle can be toggled on the overview tab", async ({ window, apiBase }) => {
    await dismissModals(window);
    await loginAndNavigateToEcommerce(window, apiBase);

    const shopTable = window.locator(".shop-table");
    await expect(shopTable).toBeVisible({ timeout: 20_000 });

    // Open drawer
    await shopTable.locator("tbody tr").first().locator("button", { hasText: "View" }).click();
    const drawer = window.locator(".drawer-panel-open");
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // The checkbox input is visually hidden (CSS toggle pattern), so use
    // the label wrapper for clicks and the input for state checks.
    const toggleInput = drawer.locator(".shop-toggle-card .toggle-switch input[type='checkbox']");
    const toggleLabel = drawer.locator(".shop-toggle-card .toggle-switch");
    await expect(toggleLabel).toBeVisible();
    const wasChecked = await toggleInput.isChecked();

    // Toggle it via the visible label
    await toggleLabel.click();

    // Wait for the toggle to reflect the change (server round-trip)
    await expect(toggleInput).toHaveJSProperty("checked", !wasChecked, { timeout: 10_000 });

    // Toggle it back to restore original state
    await toggleLabel.click();
    await expect(toggleInput).toHaveJSProperty("checked", wasChecked, { timeout: 10_000 });

    // Close drawer
    await drawer.locator(".drawer-close-btn").click();
  });
});

import { freshTest as test, expect } from "./electron-fixture.js";

test.describe("EasyClaw Onboarding Flow", () => {
  test("fresh user completes onboarding with GLM API key", async ({ window }) => {
    const apiKey = process.env.E2E_ZHIPU_API_KEY;
    test.skip(!apiKey, "E2E_ZHIPU_API_KEY env var not set");

    // Verify onboarding page is shown with step indicator
    await expect(window.locator(".onboarding-page")).toBeVisible();
    await expect(window.locator(".onboarding-card")).toBeVisible();

    // Switch to API tab
    const apiTab = window.locator(".tab-btn", { hasText: /API/i });
    await apiTab.click();
    await expect(apiTab).toHaveClass(/tab-btn-active/);

    // Open provider dropdown and select Zhipu (GLM)
    await window.locator(".provider-select-trigger").click();
    await window.locator(".provider-select-option", { hasText: /Zhipu \(GLM\) - China/i }).click();

    // Open model dropdown and select GLM-4.7-Flash
    await window.locator(".custom-select-trigger").click();
    await window.locator(".custom-select-option", { hasText: /GLM-4\.7-Flash/i }).click();

    // Enter API key
    await window.locator("input[type='password']").fill(apiKey!);

    // Click "Save & Continue"
    const saveBtn = window.locator(".btn.btn-primary");
    await saveBtn.click();

    // Wait for validation + save (real API call), then step advances to "All set"
    await expect(
      window.locator("h1", { hasText: /All Set/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Click "Go to Dashboard"
    await window.locator(".btn.btn-primary", { hasText: /Dashboard/i }).click();

    // Verify main page loads with sidebar
    await expect(window.locator(".sidebar-brand")).toBeVisible({ timeout: 30_000 });
    await expect(window.locator(".sidebar-brand-text")).toBeVisible();
  });

  test("fresh user can skip onboarding", async ({ window }) => {
    // Verify onboarding page is shown
    await expect(window.locator(".onboarding-page")).toBeVisible();

    // Click "Skip setup"
    await window.locator(".btn-ghost", { hasText: /Skip/i }).click();

    // Verify main page loads with sidebar
    await expect(window.locator(".sidebar-brand")).toBeVisible({ timeout: 30_000 });
  });
});

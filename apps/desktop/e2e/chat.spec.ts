import { test, expect } from "./electron-fixture.js";

const API_BASE = "http://127.0.0.1:3210";

test.describe("Chat Page", () => {
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

  test("gateway reconnects within 10 seconds after model switch", async ({ window }) => {
    test.skip(!process.env.E2E_VOLCENGINE_API_KEY, "E2E_VOLCENGINE_API_KEY required");

    // Verify we start connected
    const connectedDot = window.locator(".chat-status-dot-connected");
    await expect(connectedDot).toBeVisible();

    // Get the active provider key
    const keysRes = await fetch(`${API_BASE}/api/provider-keys`);
    const { keys } = (await keysRes.json()) as {
      keys: Array<{ id: string; model: string; isDefault: boolean }>;
    };
    const activeKey = keys.find((k) => k.isDefault);
    expect(activeKey).toBeTruthy();

    // Switch to a different model to trigger a full gateway restart.
    // The actual model name doesn't matter — we're measuring restart speed.
    const newModel = activeKey!.model.includes("pro")
      ? "doubao-seed-1-6-flash-250828"
      : "doubao-1.5-pro-32k-250115";

    const switchStart = Date.now();

    const res = await fetch(`${API_BASE}/api/provider-keys/${activeKey!.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: newModel }),
    });
    expect(res.ok).toBe(true);

    // Gateway does full stop+start on model change.
    // Wait for disconnection, then reconnection — all within 10 seconds.
    await connectedDot.waitFor({ state: "hidden", timeout: 5_000 });
    await expect(connectedDot).toBeVisible({ timeout: 10_000 });

    const elapsed = Date.now() - switchStart;
    expect(elapsed).toBeLessThan(10_000);
  });
});

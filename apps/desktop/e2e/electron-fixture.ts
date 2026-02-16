import { test as base, type ElectronApplication, type Page } from "@playwright/test";
import { _electron } from "playwright";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath = require("electron") as unknown as string;

const API_BASE = "http://127.0.0.1:3210";

/** Create a unique temp directory for data isolation. */
function createTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "easyclaw-e2e-"));
}

/** Build a clean env for Electron with data isolation via temp dir. */
function buildEnv(tempDir: string): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;

  // Isolate all persistent state to the temp directory
  env.EASYCLAW_DB_PATH = path.join(tempDir, "db.sqlite");
  env.EASYCLAW_SECRETS_DIR = path.join(tempDir, "secrets");
  env.OPENCLAW_STATE_DIR = path.join(tempDir, "openclaw");

  return env;
}

type ElectronFixtures = {
  electronApp: ElectronApplication;
  window: Page;
};

/** Shared logic to launch Electron with data isolation. */
async function launchElectronApp(
  use: (app: ElectronApplication) => Promise<void>,
) {
  const tempDir = createTempDir();
  const env = buildEnv(tempDir);
  const execPath = process.env.E2E_EXECUTABLE_PATH;
  let app: ElectronApplication;

  if (execPath) {
    // Prod mode: launch the packaged app binary
    app = await _electron.launch({
      executablePath: execPath,
      args: ["--lang=en"],
      env,
    });
  } else {
    const mainPath = path.resolve("dist/main.cjs");
    app = await _electron.launch({
      executablePath: electronPath,
      args: ["--lang=en", mainPath],
      env,
    });
  }

  let testFailed = false;
  try {
    await use(app);
  } catch (err) {
    testFailed = true;
    throw err;
  } finally {
    await app.close();
    if (testFailed) {
      // Keep temp dir for debugging — print its path
      console.log(`[e2e] Test FAILED — temp dir preserved: ${tempDir}`);
    } else {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * Force the Electron window to the foreground.
 * On Windows, background processes cannot call SetForegroundWindow directly.
 * The setAlwaysOnTop trick bypasses this restriction.
 */
async function bringWindowToFront(electronApp: ElectronApplication) {
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();
    win.setAlwaysOnTop(false);
  });
}

/** Seed a provider key via the gateway REST API. */
async function seedProvider(opts: {
  provider: string;
  model: string;
  apiKey: string;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/provider-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: opts.provider,
      label: "E2E Test Key",
      model: opts.model,
      apiKey: opts.apiKey,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to seed provider key: ${res.status} ${text}`);
  }

  const settingsRes = await fetch(`${API_BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ "llm-provider": opts.provider }),
  });
  if (!settingsRes.ok) {
    throw new Error(`Failed to set active provider: ${settingsRes.status}`);
  }
}

/**
 * Returning-user fixture: seeds a volcengine provider key via the
 * gateway API when E2E_VOLCENGINE_API_KEY is set. Otherwise, skips
 * onboarding so basic smoke tests still work without real API keys.
 *
 * Always lands on the main page with sidebar visible.
 */
export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    await launchElectronApp(use);
  },

  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 45_000 });
    await window.waitForLoadState("domcontentloaded");

    // Wait for the page to render (onboarding or main page)
    await window.waitForSelector(".onboarding-page, .sidebar-brand", {
      timeout: 45_000,
    });
    await bringWindowToFront(electronApp);

    // If onboarding is shown, either seed a real provider or skip
    if (await window.locator(".onboarding-page").isVisible()) {
      const apiKey = process.env.E2E_VOLCENGINE_API_KEY;
      if (apiKey) {
        await seedProvider({
          provider: "volcengine",
          model: "doubao-seed-1-6-flash-250828",
          apiKey,
        });
        // Wait for gateway to complete all restart cycles after provider seeding.
        // On Windows, provider seeding triggers multiple restarts (config + model change),
        // each requiring a full stop+start since SIGUSR1 is not supported.
        await window.waitForTimeout(10000);
        // Reload to trigger onboarding check — the app needs to re-mount to detect
        // the newly configured provider and transition to the main page.
        await window.reload();
      } else {
        // No API key available — skip onboarding to reach the main page
        await window.locator(".btn-ghost").click();
      }
      await window.waitForSelector(".sidebar-brand", { timeout: 45_000 });
    }

    await use(window);
  },
});

/**
 * Fresh-user fixture: launches with an empty database so the app
 * shows the onboarding page.
 */
export const freshTest = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    await launchElectronApp(use);
  },

  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 45_000 });
    await window.waitForLoadState("domcontentloaded");
    await window.waitForSelector(".onboarding-page", { timeout: 45_000 });
    await bringWindowToFront(electronApp);

    await use(window);
  },
});

export { expect } from "@playwright/test";

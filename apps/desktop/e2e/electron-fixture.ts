import { test as base, type ElectronApplication, type Page } from "@playwright/test";
import { _electron } from "playwright";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createConnection } from "node:net";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath = require("electron") as unknown as string;

const API_BASE = "http://127.0.0.1:3210";
const GATEWAY_PORT = 28789;

/**
 * Kill any process using the gateway port and wait until it's free.
 *
 * Race-condition fix: after app.close(), the detached gateway may still be
 * starting up (not yet LISTENING). We first wait a beat for it to bind, then
 * kill processes in ANY state on the port (not just LISTENING), and repeat
 * the kill-probe cycle to catch late binders.
 */
async function ensurePortFree(port: number): Promise<void> {
  // Give the detached gateway a moment to finish binding (if it's mid-startup).
  await new Promise((r) => setTimeout(r, 1000));

  for (let attempt = 0; attempt < 3; attempt++) {
    // Kill any process associated with the port (any state: LISTENING, ESTABLISHED, TIME_WAIT…)
    if (process.platform === "win32") {
      try {
        const out = execSync("netstat -ano", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], shell: "cmd.exe" });
        const pids = new Set<string>();
        for (const line of out.split("\n")) {
          if (line.includes(`:${port} `) || line.includes(`:${port}\r`)) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
          }
        }
        for (const pid of pids) {
          try { execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore", shell: "cmd.exe" }); } catch {}
        }
      } catch {}
    } else {
      try { execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore" }); } catch {}
    }

    // Wait until the port is actually free (up to 5s per attempt)
    let freed = false;
    for (let i = 0; i < 50; i++) {
      const inUse = await new Promise<boolean>((resolve) => {
        const sock = createConnection({ port, host: "127.0.0.1" });
        sock.once("connect", () => { sock.destroy(); resolve(true); });
        sock.once("error", () => resolve(false));
      });
      if (!inUse) { freed = true; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (freed) return;
    // Port still in use — wait and retry the kill cycle
    await new Promise((r) => setTimeout(r, 1000));
  }
}

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
    // The gateway runs detached and may outlive the Electron process.
    // Kill it and wait for port 28789 to be free before the next test.
    await ensurePortFree(GATEWAY_PORT);
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
 * Always lands on the main page with a fully connected gateway, so
 * individual tests don't race against gateway startup time.
 */
export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    await launchElectronApp(use);
  },

  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({ timeout: 45_000 });
    await window.waitForLoadState("domcontentloaded");

    // Pre-dismiss telemetry consent so the dialog never blocks test interactions.
    // Must run before React's useEffect checks localStorage.
    await window.evaluate(() => localStorage.setItem("telemetry.consentShown", "1"));

    // Wait for the page to render (onboarding or main page)
    await window.waitForSelector(".onboarding-page, .sidebar-brand", {
      timeout: 45_000,
    });
    await bringWindowToFront(electronApp);

    // If onboarding is shown, skip it first to reach the main page.
    // Provider seeding (if needed) happens AFTER the gateway is fully
    // connected — this avoids restarting a barely-started gateway during
    // the startup grace period, which causes 50+ second hangs on Windows.
    if (await window.locator(".onboarding-page").isVisible()) {
      await window.locator(".btn-ghost").click();
      await window.waitForSelector(".sidebar-brand", { timeout: 45_000 });
    }

    // Wait for the gateway to be fully connected before proceeding.
    // The gateway takes 6-7 s to bind on Windows (extensions load before
    // the port opens). Waiting here removes the race from every test.
    await window.waitForSelector(".chat-status-dot-connected", {
      timeout: 45_000,
    });

    // Now that the gateway is fully started, seed the provider key if an
    // API key is available. This triggers a gateway restart (stop+start on
    // Windows) but the gateway is well past the startup grace period, so
    // the restart is clean — no compile cache corruption, no cold-start hang.
    const apiKey = process.env.E2E_VOLCENGINE_API_KEY;
    if (apiKey) {
      await seedProvider({
        provider: "volcengine",
        model: "doubao-seed-1-6-flash-250828",
        apiKey,
      });
      // Wait for the gateway restart to complete and reconnect.
      // The status dot goes hidden during restart, then reappears.
      await window.waitForSelector(".chat-status-dot-connected", {
        state: "hidden",
        timeout: 10_000,
      }).catch(() => {
        // May already be reconnected if restart was fast
      });
      await window.waitForSelector(".chat-status-dot-connected", {
        timeout: 45_000,
      });
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

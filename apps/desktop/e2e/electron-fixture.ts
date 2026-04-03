import { test as base, type ElectronApplication, type Page, type TestInfo } from "@playwright/test";
import { _electron } from "playwright";
import path from "node:path";
import dotenv from "dotenv";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createConnection } from "node:net";

// Load e2e/.env via dotenv in every worker process.
// Playwright config's env changes don't propagate to Electron test workers.
dotenv.config({ path: path.resolve(__dirname, ".env") });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath = require("electron") as unknown as string;

/** Default ports — each parallel worker offsets by workerIndex * 100. */
const DEFAULT_GATEWAY_PORT = 28789;
const DEFAULT_PANEL_PORT = 3210;
const DEFAULT_PROXY_ROUTER_PORT = 9999;

export type WorkerPorts = {
  gateway: number;
  panel: number;
  proxy: number;
};

/** Check if a port is currently in use (TCP connect probe). */
async function isPortInUse(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const sock = createConnection({ port, host: "127.0.0.1" });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
  });
}

/**
 * Get PIDs of processes LISTENING on a port (servers only, not clients).
 *
 * Using -sTCP:LISTEN is critical for parallel safety: without it, lsof
 * returns client connections too (e.g. Electron's WebSocket to its own
 * gateway), and kill -9 on the Electron PID tears down the entire process
 * tree — including unrelated tests sharing that Electron worker.
 */
function getListeningPids(port: number): string[] {
  if (process.platform === "win32") {
    try {
      const out = execSync("netstat -ano", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], shell: "cmd.exe" });
      const pids = new Set<string>();
      for (const line of out.split("\n")) {
        if (line.includes(`:${port}`) && line.includes("LISTENING")) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid)) pids.add(pid);
        }
      }
      return [...pids];
    } catch { return []; }
  }
  try {
    // -sTCP:LISTEN → only server/listening sockets, never client connections
    return execSync(`lsof -ti :${port} -sTCP:LISTEN 2>/dev/null`, { encoding: "utf-8" })
      .trim().split("\n").filter(Boolean);
  } catch { return []; }
}

/**
 * Ensure a port is free, killing the listener if necessary.
 *
 * Strategy: SIGTERM first (graceful), wait up to 3s, then SIGKILL.
 * On Windows: taskkill /F (always forceful, no graceful alternative).
 *
 * Only targets LISTENING processes — never client connections — so parallel
 * workers that happen to have WebSocket clients on another worker's port
 * are never affected.
 */
async function ensurePortFree(port: number): Promise<void> {
  // Quick check — skip the lsof/kill overhead if already free
  if (!await isPortInUse(port)) return;

  const pids = getListeningPids(port);
  if (pids.length === 0) {
    // Port in use but no listener found (transient state) — wait briefly
    await new Promise((r) => setTimeout(r, 500));
    if (!await isPortInUse(port)) return;
  }

  if (process.platform === "win32") {
    for (const pid of pids) {
      try { execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore", shell: "cmd.exe" }); } catch {}
    }
  } else {
    // Phase 1: SIGTERM (graceful shutdown — lets gateway close sockets cleanly)
    for (const pid of pids) {
      try { process.kill(Number(pid), "SIGTERM"); } catch {}
    }

    // Wait up to 3s for graceful exit
    for (let i = 0; i < 30; i++) {
      if (!await isPortInUse(port)) return;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Phase 2: SIGKILL (force — only if SIGTERM didn't work)
    const remaining = getListeningPids(port);
    for (const pid of remaining) {
      try { process.kill(Number(pid), "SIGKILL"); } catch {}
    }
  }

  // Wait until the port is actually free (up to 5s)
  for (let i = 0; i < 50; i++) {
    if (!await isPortInUse(port)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Wait for a TCP port to start accepting connections (gateway readiness check).
 *
 * The ChatPage's GatewayChatClient uses exponential backoff (800ms → 15s max)
 * when reconnecting. Under parallel e2e load, the gateway may take several
 * seconds to start listening, and the backoff schedule can misalign — the
 * client sleeps 15s right when the gateway becomes ready. Waiting at the TCP
 * level (500ms poll, no backoff) decouples the fixture from the browser-side
 * retry schedule and makes the connection time deterministic.
 */
async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listening = await new Promise<boolean>((resolve) => {
      const sock = createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => { sock.destroy(); resolve(true); });
      sock.once("error", () => resolve(false));
    });
    if (listening) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Gateway port ${port} did not start listening within ${timeoutMs}ms`);
}

/**
 * Compute unique ports for a Playwright worker based on its index.
 *
 * Workers start at offset 100 (not 0) so worker-0 never collides with a
 * running production RivonClaw instance that uses the same default ports.
 * The vendor derives its browser CDP port from the gateway port
 * (gateway + 2 + 9 = gateway + 11), so matching gateway ports would cause
 * the test to connect to the production Chrome instead of launching its own.
 */
function computePorts(workerIndex: number): WorkerPorts {
  const offset = (workerIndex + 1) * 100;
  return {
    gateway: DEFAULT_GATEWAY_PORT + offset,
    panel: DEFAULT_PANEL_PORT + offset,
    proxy: DEFAULT_PROXY_ROUTER_PORT + offset,
  };
}

/** Create a unique temp directory for data isolation. */
function createTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "rivonclaw-e2e-"));
}

/** Build a clean env for Electron with data + port isolation. */
function buildEnv(tempDir: string, ports: WorkerPorts): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;

  // Isolate all persistent state to the temp directory
  env.RIVONCLAW_DB_PATH = path.join(tempDir, "db.sqlite");
  env.RIVONCLAW_SECRETS_DIR = path.join(tempDir, "secrets");
  env.OPENCLAW_STATE_DIR = path.join(tempDir, "openclaw");
  // Isolate logs per worker so parallel test failures can be diagnosed independently.
  env.RIVONCLAW_LOG_DIR = path.join(tempDir, "logs");

  // Assign unique ports so parallel workers don't collide
  env.RIVONCLAW_GATEWAY_PORT = String(ports.gateway);
  env.RIVONCLAW_PANEL_PORT = String(ports.panel);
  env.RIVONCLAW_PROXY_ROUTER_PORT = String(ports.proxy);


  // Skip the file-based gateway lock (acquireGatewayLock).  The lock uses
  // os.tmpdir()/openclaw-<uid>/gateway.<hash>.lock — a shared directory.
  // On macOS the stale-lock check only calls isPidAlive (no argv verification),
  // so PID reuse makes the lock appear active → 5 s timeout → GatewayLockError.
  // Combined with the launcher's exponential backoff (1-2-4-8-16 s) a single
  // false-positive lock collision cascades past the 30 s fixture timeout.
  // In E2E each test already has its own state dir, so the file lock adds no
  // safety — the port bind (EADDRINUSE) is sufficient.
  env.OPENCLAW_ALLOW_MULTI_GATEWAY = "1";

  // Disable Bonjour/mDNS service advertisement.  mDNS service names are
  // global (multicast DNS, not scoped by port), so parallel gateways cause
  // name conflicts → @homebridge/ciao throws "Can't probe for a service
  // which is announced already" → unhandled rejection → exit code 1.
  env.OPENCLAW_DISABLE_BONJOUR = "1";

  return env;
}

type ElectronFixtures = {
  ports: WorkerPorts;
  apiBase: string;
  electronApp: ElectronApplication;
  window: Page;
};

/** Shared state for the current Electron instance. */
let _currentTempDir: string | null = null;

/** Get the temp dir of the current Electron instance (for log access). */
export function getCurrentTempDir(): string | null {
  return _currentTempDir;
}

/** Dump Desktop logs from the isolated per-test log directory. */
/** Attach Desktop logs to the Playwright test report on failure. */
async function attachDesktopLogs(
  tempDir: string,
  testInfo: TestInfo,
): Promise<void> {
  // Always attach logs — testInfo.status may not be set yet during fixture
  // teardown. The HTML report will show them for all tests; the cost is minimal.

  const logFile = path.join(tempDir, "logs", "rivonclaw.log");
  if (!existsSync(logFile)) {
    await testInfo.attach("desktop-log", {
      body: `(no log file at ${logFile})`,
      contentType: "text/plain",
    });
    return;
  }

  // Attach full log file — visible in Playwright HTML report's Attachments tab
  await testInfo.attach("desktop-log-full", {
    path: logFile,
    contentType: "text/plain",
  });

  // Also attach a filtered summary for quick diagnosis
  const log = readFileSync(logFile, "utf-8");
  const lines = log.split("\n");
  const keyLines = lines.filter((l: string) =>
    /ERROR|WARN|Gateway ready|startup-timer.*READY|Gateway process/.test(l),
  );
  const summary = [
    `=== Key log lines (${keyLines.length}) ===`,
    ...keyLines.slice(-30),
    "",
    "=== Last 20 log lines ===",
    ...lines.slice(-20),
  ].join("\n");

  await testInfo.attach("desktop-log-summary", {
    body: summary,
    contentType: "text/plain",
  });
}

/** Shared logic to launch Electron with data + port isolation. */
async function launchElectronApp(
  use: (app: ElectronApplication) => Promise<void>,
  ports: WorkerPorts,
  testInfo: TestInfo,
) {
  // Kill any leftover gateway from a previous test or test-suite run
  // BEFORE launching Electron, so the new gateway never hits EADDRINUSE.
  await ensurePortFree(ports.gateway);
  await ensurePortFree(ports.panel);

  const tempDir = createTempDir();
  _currentTempDir = tempDir;
  const env = buildEnv(tempDir, ports);
  const execPath = process.env.E2E_EXECUTABLE_PATH;
  let app: ElectronApplication;

  // Use a per-test user-data-dir so each instance gets its own
  // single-instance lock. Without this, force-killed prod instances
  // leave a stale lock that blocks subsequent test launches.
  const userDataDir = path.join(tempDir, "electron-data");

  if (execPath) {
    // Prod mode: launch the packaged app binary
    app = await _electron.launch({
      executablePath: execPath,
      args: ["--lang=en", `--user-data-dir=${userDataDir}`],
      env,
    });
  } else {
    const mainPath = path.resolve("dist/main.cjs");
    app = await _electron.launch({
      executablePath: electronPath,
      args: ["--lang=en", mainPath, `--user-data-dir=${userDataDir}`],
      env,
    });
  }

  try {
    await use(app);
  } finally {
    await app.close();
    // The gateway runs detached and may outlive the Electron process.
    // Wait briefly for it to exit naturally (app.close sends SIGTERM to the
    // process tree), then force-kill only if it's still listening.
    await new Promise((r) => setTimeout(r, 1_000));
    await ensurePortFree(ports.gateway);

    // Attach Desktop logs to the Playwright report on failure (covers failures
    // in ANY fixture, not just inside use(app)).
    await attachDesktopLogs(tempDir, testInfo);

    const failed = testInfo.status !== "passed";
    if (failed) {
      console.log(`[e2e] Test FAILED — temp dir preserved: ${tempDir}`);
    } else {
      // Retry once: detached gateway processes may still hold file handles
      // briefly after ensurePortFree, causing ENOTEMPTY on first attempt.
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        await new Promise((r) => setTimeout(r, 500));
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
    _currentTempDir = null;
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


/**
 * Returning-user fixture: skips onboarding to reach the main page.
 *
 * Always lands on the main page with a fully connected gateway, so
 * individual tests don't race against gateway startup time.
 */
export const test = base.extend<ElectronFixtures>({
  ports: async ({}, use, testInfo) => {
    await use(computePorts(testInfo.workerIndex));
  },

  apiBase: async ({ ports }, use) => {
    await use(`http://127.0.0.1:${ports.panel}`);
  },

  electronApp: async ({ ports }, use, testInfo) => {
    await launchElectronApp(use, ports, testInfo);
  },

  window: async ({ electronApp, apiBase, ports }, use) => {
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

    // If onboarding is shown, skip it to reach the main page
    if (await window.locator(".onboarding-page").isVisible()) {
      await window.locator(".btn-ghost").click();
      await window.waitForSelector(".sidebar-brand", { timeout: 45_000 });
    }

    // Wait for the gateway port to accept TCP connections first.
    // This decouples the fixture from ChatPage's WebSocket exponential backoff
    // (800ms → 15s max), which can misalign with gateway readiness under load.
    await waitForPort(ports.gateway, 45_000);

    // Now that the gateway is listening, the ChatPage's next reconnect attempt
    // will succeed. Worst case: one max-backoff cycle (15s) if the client is
    // currently sleeping between retries, plus handshake time.
    await window.waitForSelector(".chat-status-dot-connected", {
      timeout: 30_000,
    });

    await use(window);
  },
});

/**
 * Fresh-user fixture: launches with an empty database so the app
 * shows the onboarding page.
 */
export const freshTest = base.extend<ElectronFixtures>({
  ports: async ({}, use, testInfo) => {
    await use(computePorts(testInfo.workerIndex));
  },

  apiBase: async ({ ports }, use) => {
    await use(`http://127.0.0.1:${ports.panel}`);
  },

  electronApp: async ({ ports }, use, testInfo) => {
    await launchElectronApp(use, ports, testInfo);
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

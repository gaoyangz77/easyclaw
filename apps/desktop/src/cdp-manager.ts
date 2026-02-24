import { createLogger } from "@easyclaw/logger";
import type { WriteGatewayConfigOptions } from "@easyclaw/gateway";
import { get as httpGet } from "node:http";
import { createConnection } from "node:net";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  existsSync, readFileSync, lstatSync, readlinkSync,
  readdirSync, unlinkSync, rmSync, mkdirSync, symlinkSync, copyFileSync,
} from "node:fs";
import { execSync, spawn } from "node:child_process";

const log = createLogger("cdp-manager");

export interface CdpManagerDeps {
  storage: {
    settings: {
      get(key: string): string | undefined;
      set(key: string, value: string): void;
    };
  };
  launcher: { reload(): Promise<void> };
  writeGatewayConfig: (options: WriteGatewayConfigOptions) => string;
  buildFullGatewayConfig: () => WriteGatewayConfigOptions;
}

/** Probe whether a CDP endpoint is accessible on the given port. */
function probeCdp(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = httpGet(`http://127.0.0.1:${port}/json/version`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

/** Check if a TCP port is in use (by anything, not necessarily CDP). */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const sock = createConnection({ port, host: "127.0.0.1" });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
  });
}

/**
 * Resolve the Chrome/Edge/Chromium user data directory for reading Local State.
 * Returns null if not found.
 */
function resolveChromeUserDataDir(chromePath: string): string | null {
  const home = homedir();
  if (process.platform === "darwin") {
    if (chromePath.includes("Microsoft Edge")) return join(home, "Library", "Application Support", "Microsoft Edge");
    if (chromePath.includes("Chromium")) return join(home, "Library", "Application Support", "Chromium");
    return join(home, "Library", "Application Support", "Google", "Chrome");
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    if (chromePath.toLowerCase().includes("edge")) return join(localAppData, "Microsoft", "Edge", "User Data");
    return join(localAppData, "Google", "Chrome", "User Data");
  }
  // Linux
  if (chromePath.includes("chromium")) return join(home, ".config", "chromium");
  return join(home, ".config", "google-chrome");
}

/**
 * Read the last-used Chrome profile directory name from Local State.
 * Returns "Default" as fallback.
 */
function readChromeLastUsedProfile(userDataDir: string): string {
  try {
    const localStatePath = join(userDataDir, "Local State");
    if (!existsSync(localStatePath)) return "Default";
    const data = JSON.parse(readFileSync(localStatePath, "utf-8"));
    const lastUsed = data?.profile?.last_used;
    if (typeof lastUsed === "string" && lastUsed.trim()) return lastUsed.trim();
  } catch {
    // Ignore parse errors
  }
  return "Default";
}

/**
 * Create a wrapper user-data-dir that symlinks the user's Chrome profile.
 * Chrome refuses --remote-debugging-port on its default data directory,
 * so we create a separate directory with symlinks to the real profile.
 * On Windows, directory symlinks use junctions (no admin required).
 */
function prepareCdpUserDataDir(realUserDataDir: string, profileDir: string): string {
  const cdpDataDir = join(homedir(), ".easyclaw", "chrome-cdp");
  const realProfilePath = join(realUserDataDir, profileDir);
  const cdpProfilePath = join(cdpDataDir, profileDir);

  // Check if the junction already exists and points to the correct target.
  // If so, reuse the entire wrapper dir to preserve session state, caches,
  // and any files Chrome created at the root level (e.g. updated Local State,
  // login tokens, CertificateRevocation, etc.).
  let junctionOk = false;
  try {
    const st = lstatSync(cdpProfilePath);
    if (st.isSymbolicLink()) {
      const target = readlinkSync(cdpProfilePath);
      // On Windows, junctions may have \\?\ prefix — normalize for comparison.
      const normalizedTarget = target.replace(/^\\\\\?\\/, "");
      junctionOk = normalizedTarget === realProfilePath;
    }
  } catch {
    // Junction doesn't exist or can't be read — will recreate.
  }

  if (junctionOk) {
    log.info("Reusing existing CDP wrapper dir (junction still valid)");
    return cdpDataDir;
  }

  // Junction missing or points to wrong profile — rebuild wrapper dir.
  log.info(`Rebuilding CDP wrapper dir for profile ${profileDir}`);
  if (existsSync(cdpDataDir)) {
    // Remove any existing junctions before recursive delete (extra safety).
    try {
      for (const entry of readdirSync(cdpDataDir)) {
        const entryPath = join(cdpDataDir, entry);
        try {
          if (lstatSync(entryPath).isSymbolicLink()) unlinkSync(entryPath);
        } catch {}
      }
    } catch {}
    rmSync(cdpDataDir, { recursive: true, force: true });
  }
  mkdirSync(cdpDataDir, { recursive: true });

  // Create junction/symlink to the real profile directory.
  if (existsSync(realProfilePath)) {
    const linkType = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(realProfilePath, cdpProfilePath, linkType);
    log.info(`Created ${linkType}: ${cdpProfilePath} -> ${realProfilePath}`);
  } else {
    log.warn(`Real profile path does not exist: ${realProfilePath}`);
  }

  // Copy Local State only on first creation.  Chrome reads/writes it;
  // don't symlink to avoid corrupting the original.
  const localStateSrc = join(realUserDataDir, "Local State");
  if (existsSync(localStateSrc)) {
    copyFileSync(localStateSrc, join(cdpDataDir, "Local State"));
  }

  return cdpDataDir;
}

export function createCdpManager(deps: CdpManagerDeps) {
  const { storage, launcher, writeGatewayConfig, buildFullGatewayConfig } = deps;

  async function ensureCdpChrome(): Promise<void> {
    const preferredPort = parseInt(storage.settings.get("browser-cdp-port") || "9222", 10);

    // 1. Probe preferred port — if CDP already accessible, reuse.
    if (await probeCdp(preferredPort)) {
      log.info(`CDP already reachable on port ${preferredPort}`);
      return;
    }

    // 2. Find Chrome executable (platform-specific).
    let chromePath: string | null = null;
    if (process.platform === "darwin") {
      const candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      ];
      chromePath = candidates.find((p) => existsSync(p)) ?? null;
    } else if (process.platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA ?? "";
      const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
      const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
      const candidates = [
        join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
        join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
        join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      ];
      chromePath = candidates.find((p) => existsSync(p)) ?? null;
    } else {
      // Linux
      const candidates = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
      chromePath = candidates.find((p) => existsSync(p)) ?? null;
      if (!chromePath) {
        try { chromePath = execSync("which google-chrome", { encoding: "utf-8" }).trim() || null; } catch {}
      }
    }

    if (!chromePath) {
      log.warn("Could not find Chrome executable for CDP mode");
      return;
    }
    log.info(`Found Chrome at ${chromePath}`);

    // 3. Read user's last-used Chrome profile BEFORE killing Chrome.
    const userDataDir = resolveChromeUserDataDir(chromePath);
    const profileDir = userDataDir ? readChromeLastUsedProfile(userDataDir) : "Default";
    log.info(`Chrome profile directory: ${profileDir} (from ${userDataDir ?? "fallback"})`);

    // 4. Kill existing Chrome processes so we can relaunch with debug port.
    const killChrome = () => {
      try {
        if (process.platform === "win32") {
          const exeName = chromePath!.toLowerCase().includes("edge") ? "msedge.exe" : "chrome.exe";
          execSync(`taskkill /f /im ${exeName} 2>nul & exit /b 0`, { stdio: "ignore", shell: "cmd.exe" });
        } else {
          const name = chromePath!.includes("Chromium") ? "Chromium" :
                       chromePath!.includes("Edge") ? "Microsoft Edge" : "Google Chrome";
          // Use killall (~10ms) instead of pkill which can take 20-50s on macOS
          // due to slow proc_info kernel calls when many processes are running.
          execSync(`killall -9 '${name}' 2>/dev/null || true`, { stdio: "ignore" });
        }
      } catch { /* ignore */ }
    };
    killChrome();
    // Wait for process cleanup — Chrome with many tabs needs more time
    await new Promise((r) => setTimeout(r, 3000));

    if (!userDataDir) {
      log.warn("Could not resolve Chrome user data directory for CDP mode");
      return;
    }

    // 5. Find a free port starting from preferredPort.
    let actualPort = preferredPort;
    for (let p = preferredPort; p < preferredPort + 100; p++) {
      if (!(await isPortInUse(p))) {
        actualPort = p;
        break;
      }
    }

    // 6. Create wrapper user-data-dir with symlinks/junctions to the user's
    //    profile.  Chrome (145+) refuses --remote-debugging-port on its default
    //    data directory on both macOS and Windows.  The wrapper uses a different
    //    path but links to the real profile so cookies, extensions, and logins
    //    are preserved.
    const cdpDataDir = prepareCdpUserDataDir(userDataDir, profileDir);

    // 7. Launch Chrome with --remote-debugging-port and the wrapper data dir.
    const chromeArgs = [
      `--remote-debugging-port=${actualPort}`,
      `--user-data-dir=${cdpDataDir}`,
      `--profile-directory=${profileDir}`,
    ];
    log.info(`Launching Chrome: ${chromePath} ${chromeArgs.join(" ")}`);
    const child = spawn(chromePath!, chromeArgs, { detached: true, stdio: "ignore" });
    child.unref();

    // 8. Wait for CDP port to become accessible (poll with timeout).
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      if (await probeCdp(actualPort)) {
        log.info(`Chrome CDP ready on port ${actualPort} (profile: ${profileDir})`);
        storage.settings.set("browser-cdp-port", String(actualPort));
        writeGatewayConfig(buildFullGatewayConfig());
        return;
      }
    }
    log.warn(`Chrome CDP not reachable on port ${actualPort} after 15s`);
  }

  async function handleBrowserChange(): Promise<void> {
    log.info("Browser settings changed, regenerating config");
    writeGatewayConfig(buildFullGatewayConfig());

    const mode = storage.settings.get("browser-mode") || "standalone";
    if (mode === "cdp") {
      await ensureCdpChrome();
    }

    // Browser config is hot-reloadable — SIGUSR1 suffices, no full restart.
    await launcher.reload();
  }

  return { ensureCdpChrome, handleBrowserChange };
}

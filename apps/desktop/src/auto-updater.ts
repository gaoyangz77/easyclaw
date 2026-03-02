import { formatError } from "@easyclaw/core";
import { createLogger } from "@easyclaw/logger";
import { app, Notification } from "electron";
import type { BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateInfo, ProgressInfo } from "electron-updater";
import type { UpdateDownloadState } from "@easyclaw/updater";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveUpdateMarkerPath, resolveEasyClawHome } from "@easyclaw/core/node";

const log = createLogger("auto-updater");

// ---------------------------------------------------------------------------
// Differential-update blockmap cache consistency
//
// electron-updater keeps {cacheDir}/installer.exe (the old installer) and
// {cacheDir}/current.blockmap (its block map) for differential downloads.
// Two scenarios cause installer.exe and current.blockmap to go out of sync:
//
// 1. Manual install: NSIS always copies itself to installer.exe on every
//    install, but current.blockmap is only written by the auto-update
//    download flow → installer.exe is updated, blockmap is stale.
//
// 2. Download-but-not-install: after a successful download, electron-updater
//    writes the NEW version's blockmap to current.blockmap, but installer.exe
//    only gets updated when NSIS actually runs → blockmap is for the new
//    version, installer.exe is still the old version.
//
// Either way, on the next differential download the old blockmap won't
// match installer.exe → sha512 mismatch → fallback to full download.
//
// Fix: write a "blockmap-version" marker after each successful download
// and check it before the next download.  If the marker doesn't match
// app.getVersion(), delete the stale blockmap so electron-updater
// re-downloads the correct one from the server.
// ---------------------------------------------------------------------------

function getUpdaterCacheDir(): string | null {
  try {
    const ymlPath = join(process.resourcesPath, "app-update.yml");
    if (!existsSync(ymlPath)) return null; // dev mode
    const yml = readFileSync(ymlPath, "utf-8");
    const match = yml.match(/^updaterCacheDirName:\s*(.+)$/m);
    if (!match) return null;
    const dirName = match[1].trim();

    let basePath: string;
    if (process.platform === "win32") {
      basePath = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    } else if (process.platform === "darwin") {
      basePath = join(homedir(), "Library", "Caches");
    } else {
      basePath = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
    }
    return join(basePath, dirName);
  } catch {
    return null;
  }
}

function ensureBlockmapConsistency(cacheDir: string): void {
  const markerPath = join(cacheDir, "blockmap-version");
  const blockmapPath = join(cacheDir, "current.blockmap");
  try {
    const markerVersion = readFileSync(markerPath, "utf-8").trim();
    if (markerVersion === app.getVersion()) return; // consistent
    log.info(`Blockmap cache stale (marker: ${markerVersion}, running: ${app.getVersion()}), clearing`);
  } catch {
    // No marker → blockmap may be stale (e.g. first run after manual install)
    if (!existsSync(blockmapPath)) return; // nothing to clear
    log.info(`No blockmap version marker, clearing potentially stale blockmap`);
  }
  try { unlinkSync(blockmapPath); } catch {}
  try { unlinkSync(markerPath); } catch {}
}

function writeBlockmapVersion(cacheDir: string, version: string): void {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "blockmap-version"), version);
  } catch {}
}

export interface AutoUpdaterDeps {
  locale: string;
  systemLocale: string;
  getMainWindow: () => BrowserWindow | null;
  showMainWindow: () => void;
  setIsQuitting: (v: boolean) => void;
  updateTray: () => void;
  telemetryTrack?: (event: string, meta?: Record<string, unknown>) => void;
}

export function createAutoUpdater(deps: AutoUpdaterDeps) {
  let latestUpdateInfo: UpdateInfo | null = null;
  let updateDownloadState: UpdateDownloadState = { status: "idle" };
  let runFullCleanup: (() => Promise<void>) | null = null;

  // Configure update feed URL.
  // UPDATE_FROM_STAGING=1 → use staging server for testing updates locally.
  const useStaging = process.env.UPDATE_FROM_STAGING === "1";
  const updateRegion = deps.locale === "zh" ? "cn" : "us";
  const updateFeedUrl = useStaging
    ? "https://stg.easy-claw.com/releases"
    : updateRegion === "cn"
      ? "https://www.zhuazhuaai.cn/releases"
      : "https://www.easy-claw.com/releases";
  if (useStaging) log.info("Using staging update feed: " + updateFeedUrl);
  autoUpdater.setFeedURL({
    provider: "generic",
    url: updateFeedUrl,
  });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = log;

  // Wire electron-updater events into our state machine
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    latestUpdateInfo = info;
    log.info(`Update available: v${info.version}`);
    deps.telemetryTrack?.("app.update_available", {
      currentVersion: app.getVersion(),
      latestVersion: info.version,
    });
    const isZh = deps.systemLocale === "zh";
    const notification = new Notification({
      title: isZh ? "EasyClaw 有新版本" : "EasyClaw Update Available",
      body: isZh
        ? `新版本 v${info.version} 已发布，点击查看详情。`
        : `A new version v${info.version} is available. Click to download.`,
    });
    notification.on("click", () => {
      deps.showMainWindow();
    });
    notification.show();
    deps.updateTray();
  });

  autoUpdater.on("update-not-available", () => {
    log.info(`Already up to date (${app.getVersion()})`);
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    updateDownloadState = {
      status: "downloading",
      percent: Math.round(progress.percent),
      downloadedBytes: progress.transferred,
      totalBytes: progress.total,
    };
    deps.getMainWindow()?.setProgressBar(progress.percent / 100);
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    // electron-updater's NsisUpdater exposes the downloaded file path via
    // a protected getter.  We read it at runtime to spawn the installer ourselves.
    const installerPath = (autoUpdater as unknown as { installerPath: string | null }).installerPath ?? "";
    updateDownloadState = { status: "ready", filePath: installerPath };
    deps.getMainWindow()?.setProgressBar(-1);
    log.info(`Update v${info.version} downloaded and verified`);
    deps.telemetryTrack?.("app.update_downloaded", { version: info.version });
    // Save version marker so we can detect stale blockmap after manual installs
    const cacheDir = getUpdaterCacheDir();
    if (cacheDir) writeBlockmapVersion(cacheDir, info.version);
  });

  autoUpdater.on("error", (error: Error) => {
    updateDownloadState = { status: "error", message: error.message };
    deps.getMainWindow()?.setProgressBar(-1);
    log.error(`Auto-update error: ${error.message}`);
  });

  async function check(): Promise<void> {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      const message = formatError(err);
      log.warn(`Update check failed: ${message}`);
    }
    deps.updateTray();
  }

  async function download(): Promise<void> {
    if (!latestUpdateInfo) {
      throw new Error("No update available");
    }
    if (
      updateDownloadState.status === "downloading" ||
      updateDownloadState.status === "verifying"
    ) {
      log.info(
        `Update download already ${updateDownloadState.status}, ignoring duplicate request`,
      );
      return;
    }
    if (updateDownloadState.status === "ready") {
      log.info("Update already downloaded, ignoring duplicate request");
      return;
    }

    updateDownloadState = {
      status: "downloading",
      percent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
    };
    deps.getMainWindow()?.setProgressBar(0);

    // Ensure blockmap cache matches current app version (may be stale after manual install)
    const cacheDir = getUpdaterCacheDir();
    if (cacheDir) ensureBlockmapConsistency(cacheDir);

    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      // The error event handler will set the error state
      log.error("Update download failed:", err);
    }
  }

  async function install(): Promise<void> {
    if (updateDownloadState.status !== "ready") {
      throw new Error("No downloaded update ready to install");
    }

    const installerPath = updateDownloadState.filePath;
    updateDownloadState = { status: "installing" };

    deps.telemetryTrack?.("app.update_installing", {
      version: latestUpdateInfo?.version,
    });

    // Run ALL cleanup before launching the installer.
    if (runFullCleanup) {
      try {
        await runFullCleanup();
      } catch (err) {
        log.error("Pre-update cleanup failed (proceeding anyway):", err);
      }
    }

    // Write a marker file so that if the user manually opens the app while
    // the NSIS installer is still running, the new instance can detect it
    // and exit gracefully instead of conflicting with the installer.
    // Windows-only: macOS/Linux updates don't use a separate installer process.
    if (process.platform === "win32") {
      try {
        const markerPath = resolveUpdateMarkerPath();
        mkdirSync(resolveEasyClawHome(), { recursive: true });
        writeFileSync(markerPath, latestUpdateInfo?.version ?? "", { flag: "w" });
      } catch {}
    }

    const isZh = deps.systemLocale === "zh";
    new Notification({
      title: isZh ? "EasyClaw 正在更新" : "EasyClaw Updating",
      body: isZh
        ? "安装程序正在运行，完成后将自动启动。请勿手动打开应用。"
        : "The installer is running. The app will restart automatically.",
    }).show();

    deps.setIsQuitting(true);

    // On Windows we bypass quitAndInstall() entirely to eliminate the race
    // condition between NSIS and the Electron shutdown sequence.  Instead:
    //   1. Cleanup already completed above (gateway, proxy, db, etc.)
    //   2. Spawn the NSIS installer as a detached process
    //   3. app.exit(0) terminates immediately — no before-quit, no async
    //
    // By the time NSIS checks for running processes, this process is already
    // dead.  Deterministic, no timing dependency.
    if (process.platform === "win32" && installerPath) {
      log.info(`Spawning installer: ${installerPath} --updated --force-run`);
      const child = spawn(installerPath, ["--updated", "--force-run"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      app.exit(0);
      return;
    }

    // macOS/Linux: use electron-updater's built-in flow (no NSIS race issue)
    autoUpdater.quitAndInstall(false, true);
  }

  return {
    check,
    download,
    install,
    getLatestInfo: () => latestUpdateInfo,
    getDownloadState: () => updateDownloadState,
    setDownloadState: (state: UpdateDownloadState) => {
      updateDownloadState = state;
    },
    setRunFullCleanup: (fn: () => Promise<void>) => {
      runFullCleanup = fn;
    },
  };
}

import { createLogger } from "@easyclaw/logger";
import { app, Notification } from "electron";
import type { BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateInfo, ProgressInfo } from "electron-updater";
import type { UpdateDownloadState } from "@easyclaw/updater";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const log = createLogger("auto-updater");

export interface AutoUpdaterDeps {
  locale: string;
  systemLocale: string;
  getMainWindow: () => BrowserWindow | null;
  showMainWindow: () => void;
  setIsQuitting: (v: boolean) => void;
  updateTray: () => void;
  telemetryTrack?: (event: string, meta?: Record<string, unknown>) => void;
  launcher: { stop(): Promise<void> };
  configPath: string;
  cleanupGatewayLock: (configPath: string) => void;
}

export function createAutoUpdater(deps: AutoUpdaterDeps) {
  let latestUpdateInfo: UpdateInfo | null = null;
  let updateDownloadState: UpdateDownloadState = { status: "idle" };

  // Configure update feed URL.
  // UPDATE_FROM_STAGING=1 → use staging server for testing updates locally.
  const useStaging = process.env.UPDATE_FROM_STAGING === "1";
  const updateRegion = deps.locale === "zh" ? "cn" : "us";
  const updateFeedUrl = useStaging
    ? "https://stg.easy-claw.com/releases"
    : updateRegion === "cn"
      ? "https://cn.easy-claw.com/releases"
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
    updateDownloadState = { status: "ready", filePath: "" };
    deps.getMainWindow()?.setProgressBar(-1);
    log.info(`Update v${info.version} downloaded and verified`);
    deps.telemetryTrack?.("app.update_downloaded", { version: info.version });
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
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Update check failed: ${message}`);
    }
    deps.updateTray();
  }

  async function download(): Promise<void> {
    if (!latestUpdateInfo) {
      throw new Error("No update available");
    }
    if (updateDownloadState.status === "downloading" || updateDownloadState.status === "verifying") {
      log.info(`Update download already ${updateDownloadState.status}, ignoring duplicate request`);
      return;
    }
    if (updateDownloadState.status === "ready") {
      log.info("Update already downloaded, ignoring duplicate request");
      return;
    }

    updateDownloadState = { status: "downloading", percent: 0, downloadedBytes: 0, totalBytes: 0 };
    deps.getMainWindow()?.setProgressBar(0);

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

    updateDownloadState = { status: "installing" };

    deps.telemetryTrack?.("app.update_installing", {
      version: latestUpdateInfo?.version,
    });

    // Kill the gateway and remove its lock file *before* quitting so the
    // installer (NSIS on Windows) and the newly installed version don't
    // encounter a stale process or lock.  The before-quit handler also calls
    // launcher.stop(), but quitAndInstall() may not await async cleanup fully.
    try { await deps.launcher.stop(); } catch {}
    deps.cleanupGatewayLock(deps.configPath);

    // Write a marker file so that if the user manually opens the app while
    // the NSIS installer is still running, the new instance can detect it
    // and exit gracefully instead of conflicting with the installer.
    // Windows-only: macOS/Linux updates don't use a separate installer process.
    if (process.platform === "win32") {
      try {
        const markerDir = join(homedir(), ".easyclaw");
        mkdirSync(markerDir, { recursive: true });
        writeFileSync(join(markerDir, "update-installing"), "", { flag: "w" });
      } catch {}
    }

    // Show a system notification before quitting so the user knows the
    // installer is running (the NSIS UI can take 10-30s to appear on Windows
    // due to process cleanup in customInit / customCheckAppRunning hooks).
    const isZh = deps.systemLocale === "zh";
    new Notification({
      title: isZh ? "EasyClaw 正在更新" : "EasyClaw Updating",
      body: isZh
        ? "安装程序正在运行，完成后将自动启动。请勿手动打开应用。"
        : "The installer is running. The app will restart automatically.",
    }).show();

    deps.setIsQuitting(true); // prevent close-to-tray
    autoUpdater.quitAndInstall(false, true);
  }

  return {
    check,
    download,
    install,
    getLatestInfo: () => latestUpdateInfo,
    getDownloadState: () => updateDownloadState,
    setDownloadState: (state: UpdateDownloadState) => { updateDownloadState = state; },
  };
}

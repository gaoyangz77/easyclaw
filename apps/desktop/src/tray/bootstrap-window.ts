import { BrowserWindow, app, ipcMain } from "electron";
import type { HydrateProgress } from "../gateway/runtime-hydrator.js";

type Locale = "zh" | "en";

const i18n = {
  en: {
    initializing: "Initializing...",
    preparing: "Preparing to configure...",
    extracting: "Configuring RivonClaw...",
    verifying: "Verifying...",
    almostReady: "Almost ready...",
    retry: "Retry",
    quit: "Quit",
  },
  zh: {
    initializing: "正在初始化...",
    preparing: "正在准备配置...",
    extracting: "正在配置爪爪...",
    verifying: "正在验证...",
    almostReady: "即将完成...",
    retry: "重试",
    quit: "退出",
  },
} as const;

function buildHtml(locale: Locale): string {
  const t = i18n[locale];
  return `<!DOCTYPE html>
<html lang="${locale === "zh" ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8">
<title>RivonClaw</title>
<style>
  :root {
    --bg-primary: #1a1a2e;
    --bg-secondary: #16213e;
    --text-primary: #e0e0e0;
    --text-secondary: #a0a0b0;
    --accent: #4a9eff;
    --accent-dim: #2a5a9f;
    --error: #ff6b6b;
    --bar-bg: #2a2a4a;
    --radius: 6px;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    -webkit-app-region: drag;
    user-select: none;
    overflow: hidden;
  }

  .title {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.5px;
    margin-bottom: 24px;
  }

  .message {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 16px;
    min-height: 18px;
    text-align: center;
    padding: 0 24px;
  }

  .progress-track {
    width: 280px;
    height: 4px;
    background: var(--bar-bg);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: var(--radius);
    transition: width 0.3s ease;
    width: 0%;
  }

  .progress-fill.indeterminate {
    width: 40%;
    animation: indeterminate 1.4s ease-in-out infinite;
  }

  @keyframes indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }

  .error-container {
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 0 24px;
    text-align: center;
  }

  .error-container.visible {
    display: flex;
  }

  .error-message {
    font-size: 13px;
    color: var(--error);
    max-height: 60px;
    overflow-y: auto;
    word-break: break-word;
    -webkit-app-region: no-drag;
  }

  .error-actions {
    display: flex;
    gap: 10px;
    -webkit-app-region: no-drag;
  }

  .btn {
    padding: 6px 20px;
    border: none;
    border-radius: var(--radius);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn:hover {
    opacity: 0.85;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .btn-secondary {
    background: var(--bar-bg);
    color: var(--text-primary);
  }

  .progress-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .progress-section.hidden {
    display: none;
  }
</style>
</head>
<body>
  <div class="title">RivonClaw</div>

  <div id="progressSection" class="progress-section">
    <div id="message" class="message">${t.initializing}</div>
    <div class="progress-track">
      <div id="progressFill" class="progress-fill indeterminate"></div>
    </div>
  </div>

  <div id="errorContainer" class="error-container">
    <div id="errorMessage" class="error-message"></div>
    <div class="error-actions">
      <button id="retryBtn" class="btn btn-primary" onclick="handleRetry()">${t.retry}</button>
      <button id="quitBtn" class="btn btn-secondary" onclick="handleQuit()">${t.quit}</button>
    </div>
  </div>

  <script>
    const { ipcRenderer } = require("electron");

    const messageEl = document.getElementById("message");
    const progressFill = document.getElementById("progressFill");
    const progressSection = document.getElementById("progressSection");
    const errorContainer = document.getElementById("errorContainer");
    const errorMessageEl = document.getElementById("errorMessage");
    const retryBtn = document.getElementById("retryBtn");

    ipcRenderer.on("hydrate-progress", (_event, progress) => {
      progressSection.classList.remove("hidden");
      errorContainer.classList.remove("visible");
      messageEl.textContent = progress.message || "";

      if (typeof progress.percent === "number") {
        progressFill.classList.remove("indeterminate");
        progressFill.style.width = progress.percent + "%";
      } else {
        progressFill.classList.add("indeterminate");
        progressFill.style.width = "";
      }
    });

    ipcRenderer.on("hydrate-error", (_event, message, canRetry) => {
      progressSection.classList.add("hidden");
      errorContainer.classList.add("visible");
      errorMessageEl.textContent = message;
      retryBtn.style.display = canRetry ? "inline-block" : "none";
    });

    function handleRetry() {
      ipcRenderer.send("hydrate-action", "retry");
    }

    function handleQuit() {
      ipcRenderer.send("hydrate-action", "quit");
    }
  </script>
</body>
</html>`;
}

export interface BootstrapWindow {
  show: () => void;
  updateProgress: (progress: HydrateProgress) => void;
  showError: (message: string, canRetry: boolean) => Promise<"retry" | "quit">;
  close: () => void;
}

/**
 * Create a frameless splash window for displaying runtime extraction progress.
 * The window uses inline HTML with no external dependencies.
 */
export function createBootstrapWindow(): BootstrapWindow {
  const locale: Locale = app.getLocale().startsWith("zh") ? "zh" : "en";

  const win = new BrowserWindow({
    width: 400,
    height: 250,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    transparent: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load inline HTML via data URL
  const html = buildHtml(locale);
  const encoded = Buffer.from(html, "utf-8").toString("base64");
  win.loadURL(`data:text/html;base64,${encoded}`);

  return {
    show() {
      win.show();
    },

    updateProgress(progress: HydrateProgress) {
      if (win.isDestroyed()) return;
      // Translate phase messages for display
      const t = i18n[locale];
      const displayMessage =
        progress.phase === "checking" ? t.initializing :
        progress.phase === "extracting" && (progress.percent ?? 0) < 5 ? t.preparing :
        progress.phase === "extracting" ? t.extracting :
        progress.phase === "verifying" ? t.verifying :
        progress.phase === "ready" ? t.almostReady :
        progress.message;
      win.webContents.send("hydrate-progress", { ...progress, message: displayMessage });
    },

    showError(message: string, canRetry: boolean): Promise<"retry" | "quit"> {
      if (win.isDestroyed()) return Promise.resolve("quit");
      win.webContents.send("hydrate-error", message, canRetry);

      return new Promise<"retry" | "quit">((resolve) => {
        let settled = false;

        const handler = (_event: Electron.IpcMainEvent, action: string) => {
          if (settled) return;
          settled = true;
          ipcMain.removeListener("hydrate-action", handler);
          resolve(action === "retry" ? "retry" : "quit");
        };
        ipcMain.on("hydrate-action", handler);

        // If the window is force-closed before the user clicks a button,
        // resolve as "quit" to prevent hanging the main process forever.
        win.once("closed", () => {
          if (settled) return;
          settled = true;
          ipcMain.removeListener("hydrate-action", handler);
          resolve("quit");
        });
      });
    },

    close() {
      if (!win.isDestroyed()) {
        win.close();
      }
    },
  };
}

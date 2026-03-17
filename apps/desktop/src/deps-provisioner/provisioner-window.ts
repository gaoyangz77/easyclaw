import { BrowserWindow, app, ipcMain } from "electron";
import type { DepStatus, ProvisionProgress, ProvisionResult } from "./types.js";

type Locale = "zh" | "en";

const i18n = {
  en: {
    subtitle: "Setting up system dependencies",
    install: "Install",
    skip: "Skip",
    continue: "Continue",
    retry: "Retry",
    detecting: "Checking system dependencies...",
    installing: "Installing",
    configuring: "Configuring mirrors...",
    done: "Setup complete",
    allPresent: "All dependencies found!",
  },
  zh: {
    subtitle: "正在配置系统依赖",
    install: "安装",
    skip: "跳过",
    continue: "继续",
    retry: "重试",
    detecting: "正在检查系统依赖...",
    installing: "正在安装",
    configuring: "正在配置镜像源...",
    done: "配置完成",
    allPresent: "所有依赖已就绪！",
  },
} as const;

const depDisplayNames: Record<string, string> = {
  git: "Git",
  python: "Python",
  node: "Node.js",
  uv: "uv",
};

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
    --success: #4caf50;
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
    height: 100vh;
    -webkit-app-region: drag;
    user-select: none;
    overflow: hidden;
    padding-top: 28px;
  }

  .title {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }

  .subtitle {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 20px;
    text-align: center;
  }

  .dep-list {
    width: 320px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .dep-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    background: var(--bg-secondary);
    border-radius: var(--radius);
  }

  .dep-icon {
    font-size: 12px;
    width: 14px;
    text-align: center;
    flex-shrink: 0;
  }

  .dep-icon-pending {
    color: var(--text-secondary);
  }

  .dep-icon-available {
    color: var(--success);
  }

  .dep-icon-installing {
    color: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }

  .dep-icon-failed {
    color: var(--error);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .dep-name {
    font-size: 13px;
    font-weight: 500;
  }

  .dep-version {
    font-size: 11px;
    color: var(--text-secondary);
    margin-left: auto;
  }

  .log-area {
    width: 320px;
    max-height: 80px;
    min-height: 40px;
    background: var(--bg-secondary);
    border-radius: var(--radius);
    padding: 6px 10px;
    font-family: "SF Mono", "Menlo", "Monaco", "Consolas", monospace;
    font-size: 11px;
    color: var(--text-secondary);
    overflow-y: auto;
    overflow-x: hidden;
    word-break: break-all;
    -webkit-app-region: no-drag;
    margin-bottom: 16px;
  }

  .log-area.hidden {
    display: none;
  }

  .log-line {
    line-height: 1.5;
  }

  .progress-track {
    width: 320px;
    height: 4px;
    background: var(--bar-bg);
    border-radius: var(--radius);
    overflow: hidden;
    margin-bottom: 16px;
  }

  .progress-track.hidden {
    display: none;
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

  .status-message {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 12px;
    min-height: 18px;
    text-align: center;
  }

  .actions {
    display: flex;
    gap: 10px;
    -webkit-app-region: no-drag;
  }

  .actions.hidden {
    display: none;
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

  .btn.hidden {
    display: none;
  }
</style>
</head>
<body>
  <div class="title">RivonClaw</div>
  <div class="subtitle">${t.subtitle}</div>

  <div id="depList" class="dep-list">
    <div class="dep-row" data-dep="git">
      <span class="dep-icon dep-icon-pending" data-icon="git">&#9679;</span>
      <span class="dep-name">Git</span>
      <span class="dep-version" data-version="git"></span>
    </div>
    <div class="dep-row" data-dep="python">
      <span class="dep-icon dep-icon-pending" data-icon="python">&#9679;</span>
      <span class="dep-name">Python</span>
      <span class="dep-version" data-version="python"></span>
    </div>
    <div class="dep-row" data-dep="node">
      <span class="dep-icon dep-icon-pending" data-icon="node">&#9679;</span>
      <span class="dep-name">Node.js</span>
      <span class="dep-version" data-version="node"></span>
    </div>
    <div class="dep-row" data-dep="uv">
      <span class="dep-icon dep-icon-pending" data-icon="uv">&#9679;</span>
      <span class="dep-name">uv</span>
      <span class="dep-version" data-version="uv"></span>
    </div>
  </div>

  <div id="logArea" class="log-area hidden"></div>

  <div id="progressTrack" class="progress-track hidden">
    <div id="progressFill" class="progress-fill indeterminate"></div>
  </div>

  <div id="statusMessage" class="status-message">${t.detecting}</div>

  <div id="actions" class="actions">
    <button id="primaryBtn" class="btn btn-primary" onclick="handlePrimary()">${t.install}</button>
    <button id="secondaryBtn" class="btn btn-secondary" onclick="handleSecondary()">${t.skip}</button>
  </div>

  <script>
    const { ipcRenderer } = require("electron");

    const logArea = document.getElementById("logArea");
    const progressTrack = document.getElementById("progressTrack");
    const progressFill = document.getElementById("progressFill");
    const statusMessage = document.getElementById("statusMessage");
    const actions = document.getElementById("actions");
    const primaryBtn = document.getElementById("primaryBtn");
    const secondaryBtn = document.getElementById("secondaryBtn");

    let currentMode = "initial"; // "initial" | "installing" | "result"

    ipcRenderer.on("provision-statuses", (_event, statuses) => {
      for (const s of statuses) {
        const icon = document.querySelector('[data-icon="' + s.name + '"]');
        const version = document.querySelector('[data-version="' + s.name + '"]');
        if (!icon) continue;

        icon.className = "dep-icon " + (s.available ? "dep-icon-available" : "dep-icon-pending");
        if (version && s.version) {
          version.textContent = "v" + s.version;
        }
      }
    });

    ipcRenderer.on("provision-progress", (_event, progress) => {
      if (progress.phase === "installing" || progress.phase === "configuring") {
        currentMode = "installing";
        actions.classList.add("hidden");
        progressTrack.classList.remove("hidden");
        logArea.classList.remove("hidden");

        if (typeof progress.percent === "number") {
          progressFill.classList.remove("indeterminate");
          progressFill.style.width = progress.percent + "%";
        } else {
          progressFill.classList.add("indeterminate");
          progressFill.style.width = "";
        }

        // Update installing dep icon
        if (progress.dep) {
          const icon = document.querySelector('[data-icon="' + progress.dep + '"]');
          if (icon && !icon.classList.contains("dep-icon-available")) {
            icon.className = "dep-icon dep-icon-installing";
          }
        }
      }

      if (progress.phase === "detecting") {
        progressTrack.classList.remove("hidden");
        progressFill.classList.add("indeterminate");
        progressFill.style.width = "";
      }

      if (progress.phase === "done") {
        progressTrack.classList.add("hidden");
      }

      statusMessage.textContent = progress.message || "";
    });

    ipcRenderer.on("provision-log", (_event, line) => {
      logArea.classList.remove("hidden");
      const div = document.createElement("div");
      div.className = "log-line";
      div.textContent = line;
      logArea.appendChild(div);
      logArea.scrollTop = logArea.scrollHeight;
    });

    ipcRenderer.on("provision-result", (_event, result) => {
      currentMode = "result";
      progressTrack.classList.add("hidden");

      // Update icons based on result
      for (const name of result.installed) {
        const icon = document.querySelector('[data-icon="' + name + '"]');
        if (icon) icon.className = "dep-icon dep-icon-available";
      }
      for (const f of result.failed) {
        const icon = document.querySelector('[data-icon="' + f.dep + '"]');
        if (icon) icon.className = "dep-icon dep-icon-failed";
      }

      // Show result actions
      actions.classList.remove("hidden");
      primaryBtn.textContent = "${t.continue}";
      primaryBtn.classList.remove("hidden");

      if (result.failed.length > 0) {
        secondaryBtn.textContent = "${t.retry}";
        secondaryBtn.classList.remove("hidden");
      } else {
        secondaryBtn.classList.add("hidden");
      }
    });

    function handlePrimary() {
      if (currentMode === "result") {
        ipcRenderer.send("provision-action", "continue");
      } else {
        ipcRenderer.send("provision-action", "install");
      }
    }

    function handleSecondary() {
      if (currentMode === "result") {
        ipcRenderer.send("provision-action", "retry");
      } else {
        ipcRenderer.send("provision-action", "skip");
      }
    }
  </script>
</body>
</html>`;
}

export interface ProvisionerWindow {
  show: () => void;
  updateStatuses: (statuses: DepStatus[]) => void;
  updateProgress: (progress: ProvisionProgress) => void;
  showResult: (result: ProvisionResult) => Promise<"continue" | "retry">;
  close: () => void;
  waitForAction: () => Promise<"install" | "skip">;
  sendLog: (line: string) => void;
}

/**
 * Create a frameless provisioner window for displaying dependency setup progress.
 * The window uses inline HTML with no external dependencies.
 */
export function createProvisionerWindow(): ProvisionerWindow {
  const locale: Locale = app.getLocale().startsWith("zh") ? "zh" : "en";
  const t = i18n[locale];

  const win = new BrowserWindow({
    width: 400,
    height: 380,
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

    updateStatuses(statuses: DepStatus[]) {
      if (win.isDestroyed()) return;
      win.webContents.send("provision-statuses", statuses);
    },

    updateProgress(progress: ProvisionProgress) {
      if (win.isDestroyed()) return;
      const t = i18n[locale];
      let displayMessage = progress.message;
      if (progress.phase === "detecting") {
        displayMessage = t.detecting;
      } else if (progress.phase === "installing" && progress.dep) {
        displayMessage = `${t.installing} ${depDisplayNames[progress.dep] ?? progress.dep}...`;
      } else if (progress.phase === "configuring") {
        displayMessage = t.configuring;
      } else if (progress.phase === "done") {
        displayMessage = t.done;
      }
      win.webContents.send("provision-progress", { ...progress, message: displayMessage });
    },

    showResult(result: ProvisionResult): Promise<"continue" | "retry"> {
      if (win.isDestroyed()) return Promise.resolve("continue");

      const allGood = result.failed.length === 0;
      const statusMsg = allGood ? t.allPresent : t.done;
      win.webContents.send("provision-progress", { phase: "done", message: statusMsg });
      win.webContents.send("provision-result", result);

      return new Promise<"continue" | "retry">((resolve) => {
        let settled = false;

        const handler = (_event: Electron.IpcMainEvent, action: string) => {
          if (settled) return;
          settled = true;
          ipcMain.removeListener("provision-action", handler);
          resolve(action === "retry" ? "retry" : "continue");
        };
        ipcMain.on("provision-action", handler);

        win.once("closed", () => {
          if (settled) return;
          settled = true;
          ipcMain.removeListener("provision-action", handler);
          resolve("continue");
        });
      });
    },

    waitForAction(): Promise<"install" | "skip"> {
      if (win.isDestroyed()) return Promise.resolve("skip");

      return new Promise<"install" | "skip">((resolve) => {
        let settled = false;

        const handler = (_event: Electron.IpcMainEvent, action: string) => {
          if (settled) return;
          if (action !== "install" && action !== "skip") return;
          settled = true;
          ipcMain.removeListener("provision-action", handler);
          resolve(action);
        };
        ipcMain.on("provision-action", handler);

        win.once("closed", () => {
          if (settled) return;
          settled = true;
          ipcMain.removeListener("provision-action", handler);
          resolve("skip");
        });
      });
    },

    close() {
      if (!win.isDestroyed()) {
        win.close();
      }
    },

    sendLog(line: string) {
      if (win.isDestroyed()) return;
      win.webContents.send("provision-log", line);
    },
  };
}

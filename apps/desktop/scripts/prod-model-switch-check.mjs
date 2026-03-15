import { _electron as electron } from "playwright";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_INITIAL_READY_BUDGET_SECONDS = 12;
const DEFAULT_MODEL_SWITCH_BUDGET_SECONDS = 8;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseReadyTimes(logText) {
  const matches = [...logText.matchAll(/Gateway ready in ([0-9.]+)s/g)];
  return matches.map((m) => Number(m[1]));
}

async function waitFor(condition, timeoutMs, intervalMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await condition();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function main() {
  const executablePath = process.argv[2];
  if (!executablePath) {
    throw new Error("Usage: node prod-model-switch-check.mjs <EasyClaw.exe>");
  }
  const initialReadyBudgetSeconds = Number(
    process.env.EASYCLAW_PROD_CHECK_INITIAL_BUDGET_SECONDS ??
      DEFAULT_INITIAL_READY_BUDGET_SECONDS,
  );
  const modelSwitchBudgetSeconds = Number(
    process.env.EASYCLAW_PROD_CHECK_SWITCH_BUDGET_SECONDS ??
      DEFAULT_MODEL_SWITCH_BUDGET_SECONDS,
  );

  const tempDir = mkdtempSync(path.join(tmpdir(), "easyclaw-prod-check-"));
  const homeDir = path.join(tempDir, "home");
  const userDataDir = path.join(tempDir, "electron-data");
  const env = {
    ...process.env,
    EASYCLAW_HOME: homeDir,
    EASYCLAW_DB_PATH: path.join(homeDir, "db.sqlite"),
    EASYCLAW_SECRETS_DIR: path.join(homeDir, "secrets"),
    OPENCLAW_STATE_DIR: path.join(homeDir, "openclaw"),
    EASYCLAW_GATEWAY_PORT: "29789",
    EASYCLAW_PANEL_PORT: "29790",
    EASYCLAW_PROXY_ROUTER_PORT: "29792",
    OPENCLAW_ALLOW_MULTI_GATEWAY: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const logPath = path.join(homeDir, "logs", "easyclaw.log");
  let app;
  let keepTempDir = false;

  try {
    app = await electron.launch({
      executablePath,
      args: ["--lang=en", `--user-data-dir=${userDataDir}`],
      env,
    });

    const window = await app.firstWindow({ timeout: 45_000 });
    await window.waitForLoadState("domcontentloaded");
    await window.evaluate(() => localStorage.setItem("telemetry.consentShown", "1"));
    await window.waitForSelector(".onboarding-page, .sidebar-brand", { timeout: 45_000 });
    if (await window.locator(".onboarding-page").isVisible().catch(() => false)) {
      await window.locator(".btn-ghost").click();
      await window.waitForSelector(".sidebar-brand", { timeout: 45_000 });
    }

    const initialReady = await waitFor(() => {
      if (!existsSync(logPath)) return null;
      const logText = readFileSync(logPath, "utf-8");
      const readyTimes = parseReadyTimes(logText);
      return readyTimes.length > 0 ? readyTimes[0] : null;
    }, 45_000);

    await window.waitForSelector(".chat-status-dot-connected", { timeout: 45_000 });

    const initialLogText = readFileSync(logPath, "utf-8");
    const initialReadyCount = parseReadyTimes(initialLogText).length;

    const providerKey = await window.evaluate(async () => {
      const create = await fetch("/api/provider-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "ollama",
          label: "Prod Check Ollama",
          model: "llama3.2",
          authType: "local",
          baseUrl: "http://127.0.0.1:11434",
        }),
      });
      if (!create.ok) {
        throw new Error(`POST /api/provider-keys failed: ${create.status}`);
      }
      return create.json();
    });

    const updatedModel = "qwen2.5-coder:7b";
    await window.evaluate(async ({ keyId, model }) => {
      const put = await fetch(`/api/provider-keys/${keyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (!put.ok) {
        throw new Error(`PUT /api/provider-keys/${keyId} failed: ${put.status}`);
      }
    }, { keyId: providerKey.id, model: updatedModel });

    const modelSwitchInfo = await waitFor(() => {
      if (!existsSync(logPath)) return null;
      const logText = readFileSync(logPath, "utf-8");
      const readyTimes = parseReadyTimes(logText);
      if (readyTimes.length < initialReadyCount + 1) return null;
      const restartMentions = (logText.match(/Config updated, performing full gateway restart for model change/g) || []).length;
      if (restartMentions < 1) return null;
      return {
        modelSwitchReady: readyTimes[initialReadyCount],
        sawBackgroundFeishu: logText.includes("feishu: scheduling background tool registration"),
      };
    }, 60_000);

    await window.waitForSelector(".chat-status-dot-connected", { timeout: 60_000 });

    if (initialReady > initialReadyBudgetSeconds) {
      throw new Error(
        `Initial gateway ready time ${initialReady}s exceeded budget ${initialReadyBudgetSeconds}s`,
      );
    }
    if (modelSwitchInfo.modelSwitchReady > modelSwitchBudgetSeconds) {
      throw new Error(
        `Model-switch gateway ready time ${modelSwitchInfo.modelSwitchReady}s exceeded budget ${modelSwitchBudgetSeconds}s`,
      );
    }

    console.log(JSON.stringify({
      initialReadySeconds: initialReady,
      modelSwitchReadySeconds: modelSwitchInfo.modelSwitchReady,
      initialReadyBudgetSeconds,
      modelSwitchBudgetSeconds,
      providerKeyId: providerKey.id,
      updatedModel,
      sawBackgroundFeishu: modelSwitchInfo.sawBackgroundFeishu,
      tempDir,
      logPath,
    }, null, 2));
  } catch (err) {
    keepTempDir = true;
    const logText = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
    const readyTimes = parseReadyTimes(logText);
    const restartMentions = (logText.match(/Config updated, performing full gateway restart for model change/g) || []).length;
    console.error(JSON.stringify({
      error: String(err),
      tempDir,
      logPath,
      readyTimes,
      restartMentions,
      logTail: logText.split(/\r?\n/).slice(-80),
    }, null, 2));
    throw err;
  } finally {
    if (app) {
      await app.close().catch(() => {});
    }
    if (!keepTempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  if (err && typeof err === "object") {
    const anyErr = err;
    if (typeof anyErr.message === "string") {
      console.error(anyErr.message);
    }
  }
  console.error(err);
  process.exitCode = 1;
});

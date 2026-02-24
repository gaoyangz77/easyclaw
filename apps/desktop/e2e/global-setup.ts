import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Load key=value pairs from a .env file into process.env. */
function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    // Don't override env vars that are already set (CLI takes priority)
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export default function globalSetup() {
  // Load API keys from e2e/.env if present
  // cwd is apps/desktop/ when running via pnpm run test:e2e:*
  loadEnvFile(resolve("e2e", ".env"));
  if (process.platform === "darwin") {
    // Use killall (~10ms) instead of pkill which can take 20-50s on macOS
    // due to slow proc_info kernel calls when many processes are running.
    try {
      execSync("killall -9 EasyClaw 2>/dev/null || true", { stdio: "ignore" });
    } catch {}
  }
  if (process.platform === "win32") {
    try {
      execSync("taskkill /F /IM EasyClaw.exe 2>nul || exit 0", { stdio: "ignore" });
    } catch {}
  }
}

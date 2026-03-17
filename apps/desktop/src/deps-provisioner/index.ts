import { platform } from "node:os";
import { createLogger } from "@rivonclaw/logger";
import type { DepName, DepStatus, ProvisionResult } from "./types.js";
import { detectDeps } from "./dep-detector.js";
import { installDep } from "./dep-installer.js";
import { configureMirrors } from "./mirror-config.js";
import { createProvisionerWindow } from "./provisioner-window.js";
import { detectRegion } from "./region-detector.js";

const log = createLogger("deps-provisioner");

export async function runDepsProvisioner(opts: {
  storage: { settings: { get(key: string): string | undefined; set(key: string, value: string): void } };
}): Promise<void> {
  const { storage } = opts;

  // 1. Detect all deps
  let statuses = await detectDeps();
  const allAvailable = statuses.every((s) => s.available);

  // 2. If all present, skip UI entirely
  if (allAvailable) {
    log.info("All system dependencies available, skipping provisioner UI");
    storage.settings.set("deps_provisioned", "true");
    return;
  }

  // 3. Some deps missing — show provisioner window
  const win = createProvisionerWindow();
  win.show();
  win.updateStatuses(statuses);

  // 4. Detection phase progress
  win.updateProgress({ phase: "detecting", message: "Checking system dependencies..." });
  win.updateStatuses(statuses);

  // 5. Wait for user action
  const action = await win.waitForAction();

  if (action === "skip") {
    storage.settings.set("deps_provisioned", "true");
    win.close();
    return;
  }

  // 6. User chose "Install" — detect network region and enter install loop
  const region = await detectRegion();
  let result: ProvisionResult = { installed: [], skipped: [], failed: [] };
  let depsToInstall: DepName[] = statuses.filter((s) => !s.available).map((s) => s.name);

  // Retry loop: keep going until user clicks "Continue" or no failures remain
  while (true) {
    // Reset failed list for this attempt
    const currentFailed: Array<{ dep: DepName; error: string }> = [];

    win.updateProgress({ phase: "installing", message: "Installing dependencies..." });

    for (const dep of depsToInstall) {
      win.updateProgress({ phase: "installing", dep, message: `Installing ${dep}...` });

      try {
        await installDep(dep, platform(), region, (line) => {
          win.sendLog(line);
        });

        // Re-detect to get version info
        statuses = await detectDeps();
        win.updateStatuses(statuses);

        result.installed.push(dep);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error(`Failed to install ${dep}: ${errorMsg}`);
        currentFailed.push({ dep, error: errorMsg });
      }
    }

    // After all deps: configure mirrors for China region
    if (region === "cn") {
      win.updateProgress({ phase: "configuring", message: "Configuring mirrors..." });
      await configureMirrors(region);
    }

    // Build result for this round
    result.failed = currentFailed;
    result.skipped = statuses.filter((s) => !s.available && !result.installed.includes(s.name) && !currentFailed.some((f) => f.dep === s.name)).map((s) => s.name);

    // Show result and wait for user decision
    win.updateProgress({ phase: "done", message: "Setup complete" });
    const decision = await win.showResult(result);

    if (decision === "retry" && currentFailed.length > 0) {
      // Retry only the failed deps
      depsToInstall = currentFailed.map((f) => f.dep);
      continue;
    }

    // User clicked "Continue" or nothing left to retry
    break;
  }

  // 8. Persist results and clean up
  storage.settings.set("deps_provisioned", "true");
  storage.settings.set("deps_provision_result", JSON.stringify(result));
  win.close();
}

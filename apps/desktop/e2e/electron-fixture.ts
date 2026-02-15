import { test as base, type ElectronApplication, type Page } from "@playwright/test";
import { _electron } from "playwright";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath = require("electron") as unknown as string;

/** Build a clean env for Electron (strip ELECTRON_RUN_AS_NODE from host). */
function cleanEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

type ElectronFixtures = {
  electronApp: ElectronApplication;
  window: Page;
};

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const isProd = !!process.env.E2E_PROD;
    let app: ElectronApplication;
    const env = cleanEnv();

    if (isProd) {
      const execPath = process.env.E2E_EXECUTABLE_PATH;
      if (!execPath) {
        throw new Error(
          "E2E_PROD is set but E2E_EXECUTABLE_PATH is missing. " +
            "Set it to the packaged app binary path.",
        );
      }
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

    await use(app);
    await app.close();
  },

  window: async ({ electronApp }, use) => {
    const isProd = !!process.env.E2E_PROD;
    const launchTimeout = isProd ? 90_000 : 45_000;
    const window = await electronApp.firstWindow({ timeout: launchTimeout });
    await window.waitForLoadState("domcontentloaded");
    await window.waitForSelector(".sidebar-brand", { timeout: launchTimeout });
    await use(window);
  },
});

export { expect } from "@playwright/test";

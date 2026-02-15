import { defineConfig } from "@playwright/test";

const isProd = !!process.env.E2E_PROD;

export default defineConfig({
  testDir: ".",
  timeout: isProd ? 120_000 : 60_000,
  expect: { timeout: isProd ? 30_000 : 15_000 },
  retries: 0,
  workers: 1, // single-instance lock prevents parallel Electron runs
  globalSetup: "./global-setup.ts",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "on-first-retry",
  },
});

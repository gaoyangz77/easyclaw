import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1, // single-instance lock prevents parallel Electron runs
  globalSetup: "./global-setup.ts",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "on-first-retry",
  },
});

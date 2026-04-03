import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";
import { resolve } from "node:path";

// Official Playwright pattern: load .env via dotenv at config time.
// Workers inherit process.env from the config process.
dotenv.config({ path: resolve(__dirname, ".env") });

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 1,
  workers: 6, // each worker gets unique ports (base + workerIndex * 100)
  globalSetup: "./global-setup.ts",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "on-first-retry",
  },
});

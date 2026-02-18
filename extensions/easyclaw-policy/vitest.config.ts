import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    alias: {
      "@easyclaw/logger": resolve(__dirname, "../../packages/logger/src/index.ts"),
      "@easyclaw/policy": resolve(__dirname, "../../packages/policy/src/index.ts"),
    },
  },
});

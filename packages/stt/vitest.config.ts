import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: false,
    alias: {
      "@easyclaw/logger": resolve(__dirname, "../logger/src/index.ts"),
      "@easyclaw/core/node": resolve(__dirname, "../core/src/node.ts"),
      "@easyclaw/core": resolve(__dirname, "../core/src/index.ts"),
    },
  },
});

import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/release/**", "**/.git/**"],
    alias: {
      "@easyclaw/logger": resolve(__dirname, "../../packages/logger/src/index.ts"),
      "@easyclaw/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      "@easyclaw/storage": resolve(__dirname, "../../packages/storage/src/index.ts"),
    },
  },
});

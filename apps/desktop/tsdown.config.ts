import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts"],
  format: "cjs",
  dts: false,
  clean: true,
  external: [
    "electron",
    "better-sqlite3",
  ],
  noExternal: [
    /^@easyclaw\//,
  ],
  treeshake: true,
  inlineOnly: false,
});

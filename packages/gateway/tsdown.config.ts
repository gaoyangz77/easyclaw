import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/volcengine-stt-cli.ts"],
  format: "esm",
  dts: true,
  clean: true,
});

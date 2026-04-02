import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/node.ts", "src/extension-client.ts", "src/mst-models.ts", "src/client-tools.ts", "src/types/cs-session.ts", "src/endpoints.ts", "src/defaults.ts"],
  format: "esm",
  dts: true,
  clean: true,
});

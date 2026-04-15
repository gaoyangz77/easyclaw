import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  // Local placeholder; will be replaced at deploy time.
  site: "http://localhost:4321",
  i18n: {
    defaultLocale: "zh",
    locales: ["zh", "en"],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});

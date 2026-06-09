import { sentryVitePlugin } from "@sentry/vite-plugin";
/// <reference types="vitest" />
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    ...(process.env.VITE_W3SPAY_SENTRY_ENABLED === "true"
      ? [sentryVitePlugin({ org: "paritytech", project: "w3spay", telemetry: false })]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
    },
  },
  build: {
    target: "es2022",
    sourcemap: true
  },
  esbuild: {
    target: "es2022",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Inject required Vite env vars for the test runtime so CI doesn't have
    // to. `requireEnvString` in `src/shared/lib/config.ts` would otherwise
    // throw at module load when any test transitively imports `@/config`.
    // Tests that want to assert the missing-env-var behaviour (e.g.
    // `tests/config.test.ts`) explicitly `delete process.env[KEY]` in a
    // try/finally, so the dummy here doesn't interfere.
    env: {
      VITE_DOTNS_PRODUCT_DOMAIN: "w3spay-test.dot",
    },
  },
});

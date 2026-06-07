import { sentryVitePlugin } from "@sentry/vite-plugin";
/// <reference types="vitest" />
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react(), sentryVitePlugin({
    org: "paritytech",
    project: "w3spay"
  })],
  resolve: {
    // Absolute `@/` imports → `src/`. Used app-wide so feature moves don't
    // cascade into hundreds of relative-path updates. SDK aliases must come
    // before the catch-all `@` so prefix matching resolves them first.
    alias: {
      "@": path.resolve(here, "src"),
    },
  },
  // dotli now owns the coinage WASM module. w3spay is a thin SDK
  // consumer; no wasm plugin or top-level-await is needed here.
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
  },
});

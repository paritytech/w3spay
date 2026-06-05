/**
 * App root — assembles the provider tree, the router, and the in-page
 * debug overlay. `main.tsx` mounts this (or short-circuits to the
 * telemetry-test surface before the providers come up).
 */

import { DebugPanel } from "@/shared/api/host/debug";

import { Providers } from "@/app/providers.tsx";
import { AppRouter } from "@/app/router/index.tsx";
import { envConfig } from "@/shared/config.ts";

export function App() {
  return (
    <Providers>
      <AppRouter />
      {envConfig.debug.enabled ? (
        <DebugPanel defaultOpen={envConfig.debug.openByDefault} initialFilter="" />
      ) : null}
    </Providers>
  );
}

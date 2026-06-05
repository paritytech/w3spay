// `./instrument` MUST be the first import. It wires Sentry's global
// error handlers before any other product module evaluates so an
// import-time throw still surfaces in the dashboard.
import "@/instrument.ts";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";

import { App } from "@/app/App.tsx";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary.tsx";
import {
  TelemetryTestScreen,
  isTelemetryTestRoute,
} from "@/features/telemetry/pages/TelemetryTestPage.tsx";
import "@/styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root container");

createRoot(container, {
  // React 19 surfaces caught / uncaught / recoverable errors through
  // these three hooks. `<ErrorBoundary>` catches what it can; the
  // remaining categories still need to ship somewhere.
  onCaughtError: Sentry.reactErrorHandler(),
  onUncaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <ErrorBoundary>
      {/* `?telemetry-test=1` short-circuits the customer flow and
          renders the team-facing telemetry surface — no query client,
          no router, no host bridge underneath it. */}
      {isTelemetryTestRoute() ? <TelemetryTestScreen /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);

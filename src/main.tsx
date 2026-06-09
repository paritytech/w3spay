// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

// `./instrument` MUST be the first import — it wires Sentry's global error
// handlers before any other product module evaluates, so an import-time throw
// still surfaces in the dashboard.
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
// Self-hosted fonts (bundled into dist) — no runtime fetch to Google Fonts.
import "@fontsource/dm-sans/latin-300.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/dm-serif-display/latin-400.css";
import "@fontsource/dm-serif-display/latin-400-italic.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "@/styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root container");

createRoot(container, {
  // React 19 routes caught / uncaught / recoverable errors through these three
  // hooks; <ErrorBoundary> catches what it can, the rest still need to ship.
  onCaughtError: Sentry.reactErrorHandler(),
  onUncaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <ErrorBoundary>
      {/* `?telemetry-test=1` short-circuits the customer flow and renders the
          team-facing telemetry surface — no query client, router, or host. */}
      {isTelemetryTestRoute() ? <TelemetryTestScreen /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);

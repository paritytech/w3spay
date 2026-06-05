/**
 * Sentry bootstrap. MUST be imported FIRST in `main.tsx` — before
 * React, before any other product module — so the SDK's global error
 * handlers wire up before anything else can throw.
 *
 * The actual init flow:
 *
 *   1. Read `envConfig.telemetry` (synchronous singleton).
 *   2. If `enabled === false`: short-circuit. No `Sentry.init` call.
 *      The journey tracker degrades to console-only mode, and Sentry's
 *      span helpers return inert spans that no-op safely.
 *   3. Otherwise: hand the telemetry config to `initTelemetry`, which
 *      pins `sendDefaultPii: false`, wires the privacy scrubbers, and
 *      omits `browserTracingIntegration` so the SDK does not auto-
 *      instrument fetch / xhr / navigation (those carry URLs and would
 *      leak the registry contract address + Bulletin gateway).
 *
 * No `withSentryReactRouter*` wiring — w3spay has no router; the whole
 * surface is a stage union.
 */

import { initTelemetry, sentryRemoteOrigins } from "@/telemetry";
import { requestRemoteOriginPermission } from "@/shared/api/host/connection.ts";

import { envConfig } from "@/shared/config.ts";

const { telemetry } = envConfig;

if (telemetry.enabled) {
  initTelemetry({
    dsn: telemetry.dsn,
    app: "w3spay",
    environment: telemetry.environment,
    tracesSampleRate: telemetry.tracesSampleRate,
  });
  // In a Polkadot host the product runs in a strict sandbox that blocks
  // outbound HTTP to every origin the host has not allowlisted — so Sentry's
  // ingest endpoint is unreachable and events silently never ship. Ask the
  // host for the Remote(origin) permission on the DSN host so the transport
  // can POST. No-op outside a host (the browser sends directly) and in
  // console-only mode (empty DSN → no origins). Fire-and-forget: the helper
  // never throws and the host persists the grant after the first run.
  void requestRemoteOriginPermission(sentryRemoteOrigins(telemetry.dsn));
} else {
  // Kill switch is on — keep the `[Journey:*]` console waterfall but
  // never load the SDK's global handlers. Logged once so a deploy can
  // confirm at a glance.
  console.info("[w3spay/telemetry] disabled via config.telemetry.enabled");
}

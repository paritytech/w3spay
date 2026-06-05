/**
 * `initTelemetry` — single-call Sentry bootstrap for the w3spay family
 * of apps.
 *
 * Pins privacy-critical defaults:
 *
 *   - `sendDefaultPii: false` (the SDK default in v8, but pinned
 *     explicitly so a future SDK bump can't quietly opt us in).
 *   - `beforeSend` / `beforeBreadcrumb` from `./scrub.ts`.
 *   - NO `replayIntegration` — see `docs/prds/w3spay.md` (replay would
 *     screen-record the confirm screen).
 *   - Browser tracing IS enabled so journey spans are stitched into a
 *     trace, but only the explicit propagation target (empty array =
 *     never set `sentry-trace` on outgoing HTTP requests) since the
 *     RPC endpoints we talk to are third-party and we MUST NOT leak
 *     trace IDs to them.
 *
 * Behaviour by `dsn`:
 *
 *   - Non-empty → real Sentry client initialises; events ship.
 *   - Empty string → `Sentry.init` runs with `enabled: false`. The
 *     SDK API surface stays live (so the JourneyTracker still emits
 *     inert spans + console logs) but nothing leaves the device.
 *
 * The kill-switch (`config.ts → telemetry.enabled === false`) is
 * checked BEFORE this function is even called — see the per-app
 * `instrument.ts`. If `initTelemetry` runs, the SDK is being wired.
 */

import * as Sentry from "@sentry/react";

import { beforeBreadcrumb, beforeSend } from "./scrub.ts";

export interface InitTelemetryOptions {
  /** Sentry DSN. Empty string = console-only mode (no network calls). */
  readonly dsn: string;
  /**
   * App identifier. Used as the `app.name` tag on every event and as
   * the `release` prefix when `release` isn't provided.
   */
  readonly app: string;
  /** Sentry environment label (e.g. `"production"`, `"pilot"`, `"dev"`). */
  readonly environment: string;
  /** Traces sample rate (0..1). Default 1.0 — pilot volume is low. */
  readonly tracesSampleRate?: number;
  /**
   * Release identifier (e.g. git sha or app version). Optional — when
   * omitted, events ship without a release association.
   */
  readonly release?: string;
}

export function initTelemetry(options: InitTelemetryOptions): void {
  const dsn = options.dsn.trim();
  Sentry.init({
    dsn: dsn === "" ? undefined : dsn,
    enabled: dsn !== "",
    environment: options.environment,
    release: options.release,
    sendDefaultPii: false,
    tracesSampleRate: options.tracesSampleRate ?? 1.0,
    // Manual spans (`Sentry.startInactiveSpan`, `Sentry.startSpan`)
    // work without the browser tracing integration. We DELIBERATELY
    // omit `browserTracingIntegration` here so the SDK does not
    // auto-instrument page loads, navigations, fetch, or XHR — every
    // one of those would attach span data containing URLs (third-
    // party RPC endpoints, Bulletin gateway, registry contract
    // address). `tracePropagationTargets: []` is a defence in depth so
    // that even if a future integration starts emitting fetch spans
    // we never set `sentry-trace` / `baggage` headers on outgoing
    // RPC calls.
    integrations: [],
    tracePropagationTargets: [],
    beforeSend,
    beforeBreadcrumb,
    initialScope: {
      tags: {
        "app.name": options.app,
        "app.env": options.environment,
      },
    },
  });
}

/**
 * `@/telemetry` — productivity telemetry primitives for the
 * w3spay family of apps.
 *
 * Three layers, top-down:
 *
 *   - **JourneyTracker<T>**: generic span-emitter for multi-step user
 *     flows. `start` / `milestone` / `complete` / `fail` map onto
 *     parent + child Sentry spans plus structured breadcrumbs. Designed
 *     so call sites in product code stay one-liners and remain safe
 *     no-ops when Sentry isn't initialised (still emits console lines
 *     so dev gets the `[Journey:*]` waterfall).
 *   - **Sentry helpers**: `withSpan`, `breadcrumb`, `captureError` —
 *     thin wrappers that funnel PII-bearing attributes through the
 *     scrubber so a stray `merchantId` literal can't reach the wire.
 *   - **`initTelemetry`**: per-app bootstrap that pins
 *     `sendDefaultPii: false`, wires the `beforeSend` / `beforeBreadcrumb`
 *     scrubbers, and refuses to attach `Sentry.replayIntegration()`
 *     (session replay would screen-record the confirm screen — never
 *     acceptable in a payments product).
 *
 * Privacy contract — see `scrub.ts`:
 *   - Any attribute key matching `SENSITIVE_KEY_RE` is rejected.
 *   - Any string attribute longer than `MAX_ATTRIBUTE_LENGTH` is
 *     rejected (catches accidental SS58/H160/hex payloads).
 *   - Refusals always `console.error` so an offending call site is
 *     visible in dev tools; never throws, so a telemetry typo
 *     cannot crash the host app.
 */

export {
  JourneyTracker,
  type JourneyOpMap,
  type JourneyTrackerOptions,
  type JourneyAttrValue,
} from "./journey-tracker.ts";
export {
  withSpan,
  breadcrumb,
  captureError,
  type SpanOp,
} from "./sentry-helpers.ts";
export {
  initTelemetry,
  type InitTelemetryOptions,
} from "./init.ts";
export { sentryRemoteOrigins } from "./origins.ts";
export {
  MAX_ATTRIBUTE_LENGTH,
  MAX_EXCEPTION_MESSAGE_LENGTH,
  SENSITIVE_KEY_RE,
  recordJourneyAttribute,
  sanitizeExceptionMessage,
  scrubAttributes,
  beforeSend,
  beforeBreadcrumb,
} from "./scrub.ts";

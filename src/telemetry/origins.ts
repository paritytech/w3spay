/**
 * Origin derivation for the telemetry transport — kept free of any
 * `@sentry/react` import so the parser stays trivially testable and can
 * be consumed by the host-permission bootstrap without dragging the SDK
 * into a code path that runs before React mounts.
 */

/**
 * Origins the telemetry transport needs the host to allowlist, derived
 * from the Sentry DSN.
 *
 * In a sandboxed Polkadot host, outbound HTTP is blocked per-origin until
 * the host grants a `Remote` permission. Sentry's ingest endpoint is the
 * DSN's host — and the ONLY origin this transport talks to: replay is
 * disabled and `tracePropagationTargets: []` (see `initTelemetry`) keeps
 * tracing headers off the third-party RPC / Bulletin calls. So the host
 * of the DSN is the complete allowlist the transport requires.
 *
 * Returns the bare hostname (no scheme, no path — the shape the host-API
 * `Remote` codec expects) to hand to `requestRemoteOriginPermission`.
 * Returns `[]` when the DSN is empty or unparseable: that is console-only
 * mode (`initTelemetry` runs Sentry with `enabled: false`), so there is
 * no network and nothing to allowlist.
 */
export function sentryRemoteOrigins(dsn: string): string[] {
  const trimmed = dsn.trim();
  if (trimmed === "") return [];
  try {
    return [new URL(trimmed).hostname];
  } catch {
    return [];
  }
}

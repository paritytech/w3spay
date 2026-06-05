/**
 * Telemetry test surface. Hidden behind `?telemetry-test=1` so it never
 * appears in a real customer flow. Renders five buttons exercising
 * every observable edge of the telemetry stack:
 *
 *   1. **Test error** — `throw` an Error and catch it through
 *      `captureError`. Verifies Sentry receives an exception with the
 *      scrubbed tag bag.
 *   2. **Test breadcrumb** — emit an allow-listed `app` breadcrumb.
 *      Verifies `beforeBreadcrumb` keeps it.
 *   3. **Test success journey** — start → milestone → complete.
 *      Verifies the root + phase spans serialise correctly.
 *   4. **Test failed journey** — start → milestone → fail with a
 *      categorical reason. Verifies the failure path.
 *   5. **Privacy regression** — call
 *      `journeyTracker.addAttributes("customer-pay", { destination })`
 *      with an SS58-looking string. `recordJourneyAttribute` MUST
 *      throw in DEV and log an error in PROD.
 *   6. **Flush queue** — `Sentry.flush()` so the dev tester can see
 *      events land in the dashboard without waiting for the default
 *      batch.
 *
 * Visually plain — the screen is for the team, not customers.
 */

import { useState } from "react";
import * as Sentry from "@sentry/react";

import { breadcrumb, captureError } from "@/telemetry";

import { journeyTracker } from "@/shared/utils/telemetry.ts";

export function TelemetryTestScreen() {
  const [log, setLog] = useState<string[]>([]);
  const appendLog = (line: string) =>
    setLog((prev) => [`${new Date().toISOString().slice(11, 19)} ${line}`, ...prev].slice(0, 50));

  const testError = () => {
    try {
      throw new Error("telemetry-test: synthetic error");
    } catch (caught) {
      captureError(caught, { test: "synthetic-error" });
      appendLog("captureError fired (synthetic-error)");
    }
  };

  const testBreadcrumb = () => {
    breadcrumb("telemetry-test breadcrumb", { test: "breadcrumb" }, "app");
    appendLog("breadcrumb emitted (test=breadcrumb)");
  };

  const testSuccessJourney = () => {
    // Use customer-pay so the dashboard's saved search picks it up.
    journeyTracker.start("customer-pay", { "payment.tipped": false });
    setTimeout(() => journeyTracker.milestone("customer-pay", "payment-submitted"), 100);
    setTimeout(() => {
      journeyTracker.complete("customer-pay", { "payment.settlement": "settled" });
      appendLog("customer-pay completed");
    }, 250);
    appendLog("customer-pay started");
  };

  const testFailedJourney = () => {
    journeyTracker.start("customer-pay", { "payment.tipped": true });
    setTimeout(() => journeyTracker.milestone("customer-pay", "payment-submitted"), 100);
    setTimeout(() => {
      journeyTracker.fail("customer-pay", "balance-low");
      appendLog("customer-pay failed (balance-low)");
    }, 250);
    appendLog("customer-pay started (will fail)");
  };

  const testPrivacyRegression = () => {
    // Start a journey so `addAttributes` has a span to attach to.
    journeyTracker.start("customer-pay");
    // `destination` matches SENSITIVE_KEY_RE → the guard refuses the
    // write, logs a console.error, and drops the attribute. Nothing
    // reaches the span; the journey continues normally so the app is
    // never blocked by a telemetry mistake.
    journeyTracker.addAttributes("customer-pay", {
      destination: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    });
    appendLog("privacy guard: refusal logged to console (attribute dropped)");
    journeyTracker.complete("customer-pay", { "payment.settlement": "settled" });
  };

  const flushQueue = async () => {
    appendLog("flushing…");
    const ok = await Sentry.flush(2_000);
    appendLog(ok ? "flushed within 2s" : "flush timed out (no DSN?)");
  };

  return (
    <section className="workspace">
      <section className="editorial-frame" style={{ padding: "16px 24px" }}>
        <header className="rail">
          <span className="rail__wordmark" style={{ fontSize: 15 }}>W3sPay</span>
          <span className="rail__eyebrow">Telemetry test</span>
        </header>
        <p style={{ marginTop: 16, fontSize: 13, lineHeight: 1.5 }}>
          Internal surface gated behind <code>?telemetry-test=1</code>.
          Every button here exercises one edge of the telemetry stack.
          The output log records what happened locally; cross-check
          against your Sentry dashboard's Performance / Issues tabs for
          what arrived.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16, maxWidth: 320 }}>
          <button type="button" onClick={testError}>Test error (captureError)</button>
          <button type="button" onClick={testBreadcrumb}>Test breadcrumb</button>
          <button type="button" onClick={testSuccessJourney}>Test success journey</button>
          <button type="button" onClick={testFailedJourney}>Test failed journey</button>
          <button type="button" onClick={testPrivacyRegression}>Privacy regression (must refuse)</button>
          <button type="button" onClick={() => void flushQueue()}>Flush queue</button>
        </div>
        <h3 style={{ marginTop: 20, fontSize: 13 }}>Log</h3>
        <pre style={{ fontSize: 11, lineHeight: 1.4, whiteSpace: "pre-wrap", marginTop: 8 }}>
          {log.length === 0 ? "(empty)" : log.join("\n")}
        </pre>
      </section>
    </section>
  );
}

/**
 * `true` when the URL query string contains `telemetry-test=1`. Cheap,
 * synchronous, safe to call from `App()`'s body — `URLSearchParams`
 * is universally supported in any browser the app runs in.
 */
export function isTelemetryTestRoute(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("telemetry-test") === "1";
}

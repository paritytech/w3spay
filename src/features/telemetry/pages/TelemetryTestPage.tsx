// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Telemetry test surface, gated behind `?telemetry-test=1` so it never appears
 * in a real customer flow. Five buttons exercise each observable edge of the
 * telemetry stack: captureError, allow-listed breadcrumb, success/failed
 * journeys, and a privacy regression — `recordJourneyAttribute` MUST throw in
 * DEV and log an error in PROD when fed an SS58-looking value — plus a flush.
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
    journeyTracker.start("w3spay:customer-pay", { "payment.tipped": false });
    setTimeout(() => journeyTracker.milestone("w3spay:customer-pay", "payment-submitted"), 100);
    setTimeout(() => {
      journeyTracker.complete("w3spay:customer-pay", { "payment.settlement": "settled" });
      appendLog("customer-pay completed");
    }, 250);
    appendLog("customer-pay started");
  };

  const testFailedJourney = () => {
    journeyTracker.start("w3spay:customer-pay", { "payment.tipped": true });
    setTimeout(() => journeyTracker.milestone("w3spay:customer-pay", "payment-submitted"), 100);
    setTimeout(() => {
      journeyTracker.fail("w3spay:customer-pay", "balance-low");
      appendLog("customer-pay failed (balance-low)");
    }, 250);
    appendLog("customer-pay started (will fail)");
  };

  const testPrivacyRegression = () => {
    // Start a journey so `addAttributes` has a span to attach to.
    journeyTracker.start("w3spay:customer-pay");
    // `destination` matches SENSITIVE_KEY_RE → the guard refuses the write,
    // logs an error, and drops the attribute; the journey continues so a
    // telemetry mistake never blocks the app.
    journeyTracker.addAttributes("w3spay:customer-pay", {
      destination: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    });
    appendLog("privacy guard: refusal logged to console (attribute dropped)");
    journeyTracker.complete("w3spay:customer-pay", { "payment.settlement": "settled" });
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
          <span className="rail__wordmark" style={{ fontSize: 15 }}>W3S Receipts</span>
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

/** `true` when the URL query string contains `telemetry-test=1`. */
export function isTelemetryTestRoute(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("telemetry-test") === "1";
}

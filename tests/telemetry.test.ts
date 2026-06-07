/**
 * Telemetry / Sentry contract. Proves the SDK is wired and that the
 * privacy scrubbers actually strip PII before anything reaches the wire.
 *
 * Two halves:
 *   1. `initTelemetry` — the enable/disable gate. A non-empty DSN must
 *      produce a live client with the privacy pins (`sendDefaultPii:
 *      false`, no trace propagation, the scrubbers attached). An empty
 *      DSN must initialise the SDK in disabled / console-only mode.
 *   2. The scrub pipeline (`beforeSend`, `beforeBreadcrumb`,
 *      `scrubAttributes`, `recordJourneyAttribute`,
 *      `sanitizeExceptionMessage`) — the privacy guarantees that make
 *      shipping events to Sentry safe in a payments product.
 */

import { afterEach, describe, expect, it } from "vitest";
import * as Sentry from "@sentry/react";
import type { Breadcrumb, ErrorEvent, EventHint } from "@sentry/react";

import {
  MAX_ATTRIBUTE_LENGTH,
  MAX_EXCEPTION_MESSAGE_LENGTH,
  beforeBreadcrumb,
  beforeSend,
  initTelemetry,
  recordJourneyAttribute,
  sanitizeExceptionMessage,
  scrubAttributes,
} from "@/telemetry";

const DSN = "https://abc123def456@o111.ingest.de.sentry.io/222";
const NO_HINT: EventHint = {};

/** Widen a partial fixture to the full `ErrorEvent` the hook expects. */
const errorEvent = (partial: Partial<ErrorEvent>): ErrorEvent =>
  partial as ErrorEvent;

afterEach(() => {
  Sentry.getGlobalScope().clear();
});

describe("initTelemetry — enable gate + privacy pins", () => {
  it("non-empty DSN initialises a live, scrubbed, no-leak client", () => {
    initTelemetry({ dsn: DSN, app: "w3spay", environment: "test" });

    const options = Sentry.getClient()?.getOptions();
    expect(options).toBeDefined();
    expect(options?.enabled).toBe(true);
    expect(options?.dsn).toBe(DSN);
    // Privacy pins that make Sentry safe for a payments surface.
    expect(options?.sendDefaultPii).toBe(false);
    // Empty target list = never set sentry-trace on outgoing RPC calls.
    expect(options?.tracePropagationTargets).toEqual([]);
    // No auto-instrumentation: BrowserTracing (and its fetch/xhr/navigation
    // spans) would carry third-party RPC + gateway URLs. Sentry still adds
    // its default error-capture integrations — those are wanted; the tracing
    // one is what we deliberately omit by passing `integrations: []`.
    const integrationNames = (options?.integrations ?? []).map((i) => i.name);
    expect(integrationNames).not.toContain("BrowserTracing");
    // The scrubbers MUST be the ones wired — proves PII filtering is live.
    expect(options?.beforeSend).toBe(beforeSend);
    expect(options?.beforeBreadcrumb).toBe(beforeBreadcrumb);
  });

  it("trims surrounding whitespace before deciding the DSN is real", () => {
    initTelemetry({ dsn: `  ${DSN}  `, app: "w3spay", environment: "test" });

    const options = Sentry.getClient()?.getOptions();
    expect(options?.enabled).toBe(true);
    expect(options?.dsn).toBe(DSN);
  });

  it("empty DSN initialises the SDK disabled (console-only mode)", () => {
    initTelemetry({ dsn: "", app: "w3spay", environment: "test" });

    const options = Sentry.getClient()?.getOptions();
    expect(options).toBeDefined();
    expect(options?.enabled).toBe(false);
    expect(options?.dsn).toBeUndefined();
  });
});

describe("beforeSend — strips request / user / tag / extra PII", () => {
  it("drops request URL, query string, and identifying headers", () => {
    const out = beforeSend(
      errorEvent({
        request: {
          url: "https://host/pay?terminal=42",
          query_string: "terminal=42",
          headers: { Referer: "r", referer: "r", Cookie: "c", cookie: "c" },
        },
      }),
      NO_HINT,
    );

    expect(out?.request?.url).toBeUndefined();
    expect(out?.request?.query_string).toBeUndefined();
    expect(out?.request?.headers).toEqual({});
  });

  it("drops user IP / email / username", () => {
    const out = beforeSend(
      errorEvent({
        user: { id: "keep", ip_address: "1.2.3.4", email: "a@b.c", username: "bob" },
      }),
      NO_HINT,
    );

    expect(out?.user?.ip_address).toBeUndefined();
    expect(out?.user?.email).toBeUndefined();
    expect(out?.user?.username).toBeUndefined();
    expect(out?.user?.id).toBe("keep");
  });

  it("drops tags / extra whose key matches a sensitive vector, keeps the rest", () => {
    const out = beforeSend(
      errorEvent({
        tags: { merchantId: "funkhaus", stage: "confirm" },
        extra: { walletAddress: "0xabc", note: "fine" },
      }),
      NO_HINT,
    );

    expect(out?.tags).toEqual({ stage: "confirm" });
    expect(out?.extra).toEqual({ note: "fine" });
  });

  it("redacts hex / ss58 / url inside exception messages and event.message", () => {
    const leak =
      "dispatch failed 0xdeadbeefcafebabe for 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY via https://rpc.polkadot.io/x";
    const out = beforeSend(
      errorEvent({
        exception: { values: [{ type: "Error", value: leak }] },
        message: leak,
      }),
      NO_HINT,
    );

    const scrubbed = out?.exception?.values?.[0]?.value ?? "";
    for (const target of [scrubbed, out?.message ?? ""]) {
      expect(target).not.toContain("0xdeadbeefcafebabe");
      expect(target).not.toContain("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
      expect(target).not.toContain("rpc.polkadot.io");
      expect(target).toContain("0x«hex»");
      expect(target).toContain("«ss58»");
      expect(target).toContain("https://«url»");
    }
  });
});

describe("beforeBreadcrumb — allow-list", () => {
  const crumb = (partial: Partial<Breadcrumb>): Breadcrumb => partial;

  it("keeps breadcrumbs we explicitly emit", () => {
    for (const category of ["journey", "telemetry", "app"]) {
      expect(beforeBreadcrumb(crumb({ category }))).not.toBeNull();
    }
  });

  it("drops auto-captured categories and category-less crumbs", () => {
    expect(beforeBreadcrumb(crumb({ category: "console" }))).toBeNull();
    expect(beforeBreadcrumb(crumb({ category: "fetch" }))).toBeNull();
    expect(beforeBreadcrumb(crumb({ category: "ui.click" }))).toBeNull();
    expect(beforeBreadcrumb(crumb({}))).toBeNull();
  });
});

describe("attribute scrubbing", () => {
  it("recordJourneyAttribute rejects sensitive keys and over-length values", () => {
    expect(recordJourneyAttribute("stage", "scan")).toBe(true);
    expect(recordJourneyAttribute("destination", "x")).toBe(false);
    expect(recordJourneyAttribute("note", "x".repeat(MAX_ATTRIBUTE_LENGTH + 1))).toBe(false);
  });

  it("scrubAttributes returns only the safe pairs", () => {
    expect(
      scrubAttributes({
        stage: "scan",
        merchantId: "funkhaus",
        blob: "x".repeat(MAX_ATTRIBUTE_LENGTH + 1),
        amount: 42,
      }),
    ).toEqual({ stage: "scan" });
  });
});

describe("sanitizeExceptionMessage", () => {
  it("caps over-long messages with an ellipsis", () => {
    const out = sanitizeExceptionMessage("x".repeat(MAX_EXCEPTION_MESSAGE_LENGTH + 100));
    expect(out.length).toBe(MAX_EXCEPTION_MESSAGE_LENGTH + 1);
    expect(out.endsWith("…")).toBe(true);
  });
});

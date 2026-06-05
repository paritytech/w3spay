/**
 * Generic productivity-telemetry tracker for multi-step user flows.
 *
 * A "journey" is a named, time-bounded user-facing flow with a discrete
 * start, intermediate milestones, and a terminal complete-or-fail edge:
 *
 *   - **w3spay** customer-pay: tap → host call → settle.
 *   - **w3spay-admin** chain-write: sign → broadcast → in-block → finalized.
 *   - **app-boot**: mount → host → auth → balance → first stage.
 *
 * The tracker emits ONE root span per journey, plus one child phase
 * span per milestone (parented via `StartSpanOptions.parentSpan`). The
 * root carries `op: ops[journeyType]`, the phase carries
 * `op: ${ops[journeyType]}.phase`. Phase spans give the Sentry Performance
 * waterfall its per-step breakdown without forcing every product call
 * site to thread a span object through.
 *
 * The tracker is safe to use when Sentry is uninitialised: Sentry's
 * span helpers return inert spans whose `.end()` / `.setAttribute()` /
 * `.setStatus()` are no-ops, and the tracker still emits the
 * `[Journey:*]` console waterfall so a dev `npm run dev` without a
 * DSN still observes the flow.
 *
 * Idempotency: `start(name)` is a no-op when `name` is already active,
 * which lets us call it from a React effect without leaking a span on
 * StrictMode's double-mount. `complete` / `fail` on an inactive
 * journey are no-ops too — the journey may have already been
 * abandoned by a route change.
 *
 * Privacy: every attribute is filtered through
 * `recordJourneyAttribute` (see `scrub.ts`). Keys matching
 * `SENSITIVE_KEY_RE` and strings longer than `MAX_ATTRIBUTE_LENGTH`
 * are refused with a console error (and, in DEV, an exception). Per-
 * journey common attributes (e.g. `app.name`, `host.kind`) are
 * filtered ONCE at construction.
 */

import * as Sentry from "@sentry/react";
import type { Span } from "@sentry/react";

import { recordJourneyAttribute, scrubAttributes } from "./scrub.ts";

/** Categorical / numeric / boolean — the only attribute shape we accept. */
export type JourneyAttrValue = string | number | boolean;

/** Map from journey kind → Sentry `op` for the root span. */
export type JourneyOpMap<T extends string> = Readonly<Record<T, string>>;

export interface JourneyTrackerOptions<T extends string> {
  /** Map from journey kind → Sentry `op` for the root span. */
  readonly ops: JourneyOpMap<T>;
  /**
   * Attributes attached to every span (root + phase). Common examples:
   * `app.name`, `app.env`, `host.kind`. Scrubbed once at construction.
   */
  readonly commonAttributes?: Readonly<Record<string, JourneyAttrValue>>;
}

interface ActiveJourney {
  readonly rootSpan: Span;
  /** Current phase span; ended when the next milestone arrives. */
  phaseSpan: Span | null;
  readonly startMs: number;
  readonly logTag: string;
}

type AttrInput = Readonly<Record<string, JourneyAttrValue>> | undefined;

export class JourneyTracker<T extends string> {
  private readonly ops: JourneyOpMap<T>;
  private readonly commonAttrs: Readonly<Record<string, JourneyAttrValue>>;
  private readonly active = new Map<T, ActiveJourney>();

  constructor(options: JourneyTrackerOptions<T>) {
    this.ops = options.ops;
    // Scrub once at construction so SDK callers don't pay the regex
    // cost per `start()`.
    this.commonAttrs = Object.freeze(scrubAttributes(options.commonAttributes));
  }

  /**
   * Open a journey of kind `name`. No-op when one is already active —
   * the call is safe to colocate with a React effect that re-runs on
   * StrictMode's double-mount.
   */
  start(name: T, attributes?: AttrInput): void {
    if (this.active.has(name)) return;
    const merged = this.mergeAttrs(attributes);
    const rootSpan = Sentry.startInactiveSpan({
      name,
      op: this.ops[name],
      attributes: merged,
    });
    const startMs = nowMs();
    this.active.set(name, {
      rootSpan,
      phaseSpan: null,
      startMs,
      logTag: `[Journey:${name}]`,
    });
    console.info(`[Journey:${name}] started`);
    Sentry.addBreadcrumb({
      category: "journey",
      type: "info",
      level: "info",
      message: `${name}/start`,
      data: merged,
    });
  }

  /**
   * Record an intermediate milestone. Closes the previous phase span
   * (if any) and opens a new one as a child of the journey's root.
   * The phase's `op` is `${ops[name]}.phase` so the waterfall groups
   * cleanly under the root.
   */
  milestone(name: T, label: string, attributes?: AttrInput): void {
    const journey = this.active.get(name);
    if (!journey) return;
    journey.phaseSpan?.end();
    const merged = this.mergeAttrs(attributes);
    const phaseSpan = Sentry.startInactiveSpan({
      name: label,
      op: `${this.ops[name]}.phase`,
      attributes: merged,
      parentSpan: journey.rootSpan,
    });
    journey.phaseSpan = phaseSpan;
    const elapsed = Math.round(nowMs() - journey.startMs);
    console.info(`${journey.logTag} ${label} @${elapsed}ms`);
    Sentry.addBreadcrumb({
      category: "journey",
      type: "info",
      level: "info",
      message: `${name}/${label}`,
      data: { ...merged, "journey.elapsed_ms": elapsed },
    });
  }

  /**
   * Terminate a journey successfully. Closes the open phase, applies
   * any final `attributes`, and marks the root span `ok`.
   */
  complete(name: T, attributes?: AttrInput): void {
    const journey = this.active.get(name);
    if (!journey) return;
    journey.phaseSpan?.end();
    const merged = this.mergeAttrs(attributes);
    if (Object.keys(merged).length > 0) {
      journey.rootSpan.setAttributes(merged);
    }
    journey.rootSpan.setStatus({ code: 1 /* OK */ });
    journey.rootSpan.end();
    this.active.delete(name);
    const elapsed = Math.round(nowMs() - journey.startMs);
    console.info(`${journey.logTag} completed in ${elapsed}ms`);
    Sentry.addBreadcrumb({
      category: "journey",
      type: "info",
      level: "info",
      message: `${name}/complete`,
      data: { ...merged, "journey.duration_ms": elapsed },
    });
  }

  /**
   * Terminate a journey unsuccessfully. `reason` is the categorical
   * label (closed set like `"balance-low"` / `"host-unavailable"`)
   * recorded as `journey.failure_reason` on the root span and used as
   * the span status message.
   *
   * When `caught` is provided, the exception is ALSO forwarded to
   * `Sentry.captureException` with `journey`, `journey.failure_reason`,
   * and the merged common attributes as tags. This is the path
   * call-site catch blocks should take so failures show up in both
   * the Performance waterfall (as a failed span) AND the Issues stream
   * (as a real exception with stack trace).
   *
   * `caught` is `unknown` so callers can pass the raw `catch` binding;
   * non-Error values are wrapped before Sentry sees them. The message
   * goes through `sanitizeExceptionMessage` inside `beforeSend`.
   */
  fail(name: T, reason: string, caught?: unknown, attributes?: AttrInput): void {
    const journey = this.active.get(name);
    if (!journey) return;
    journey.phaseSpan?.end();
    const merged = this.mergeAttrs(attributes);
    // Failure reason is the one attribute we set without going through
    // `recordJourneyAttribute` — its value comes from a closed set
    // chosen by the call site, and we capped its length below.
    const safeReason = truncate(reason, 32);
    merged["journey.failure_reason"] = safeReason;
    journey.rootSpan.setAttributes(merged);
    journey.rootSpan.setStatus({ code: 2 /* ERROR */, message: safeReason });
    journey.rootSpan.end();
    this.active.delete(name);
    const elapsed = Math.round(nowMs() - journey.startMs);
    console.info(`${journey.logTag} failed (${safeReason}) in ${elapsed}ms`);
    Sentry.addBreadcrumb({
      category: "journey",
      type: "info",
      level: "warning",
      message: `${name}/fail:${safeReason}`,
      data: { ...merged, "journey.duration_ms": elapsed },
    });
    if (caught !== undefined) {
      const exception = caught instanceof Error ? caught : new Error(String(caught));
      // Tags are categorical only — `commonAttrs` already passed the
      // `recordJourneyAttribute` filter at construction.
      const tags: Record<string, JourneyAttrValue> = {
        ...this.commonAttrs,
        journey: name,
        "journey.failure_reason": safeReason,
      };
      Sentry.captureException(exception, { tags });
    }
  }

  /** True iff a journey of kind `name` is currently active. */
  isActive(name: T): boolean {
    return this.active.has(name);
  }

  /**
   * Attach additional attributes to an active journey's root span.
   * Same scrubbing rules apply. No-op when the journey isn't active.
   */
  addAttributes(name: T, attributes: Record<string, JourneyAttrValue>): void {
    const journey = this.active.get(name);
    if (!journey) return;
    const merged = scrubAttributes(attributes);
    if (Object.keys(merged).length > 0) {
      journey.rootSpan.setAttributes(merged);
    }
  }

  private mergeAttrs(extra: AttrInput): Record<string, JourneyAttrValue> {
    const out: Record<string, JourneyAttrValue> = { ...this.commonAttrs };
    if (!extra) return out;
    for (const key of Object.keys(extra)) {
      const value = extra[key];
      if (value === undefined) continue;
      if (recordJourneyAttribute(key, value)) out[key] = value;
    }
    return out;
  }
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

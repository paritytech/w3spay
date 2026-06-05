/**
 * Thin wrappers around the Sentry SDK's tracing / breadcrumb / error
 * surfaces. Every one of them funnels caller-supplied attributes
 * through the privacy scrubber before they reach Sentry, so even an
 * `withSpan("merchant-registry.list", "chain.read", fn, { merchantId })`
 * fails closed at the helper boundary instead of leaking.
 *
 * These helpers exist on top of `JourneyTracker` for one reason: not
 * every observable operation is a multi-step journey. Some are
 * point-in-time spans (a chain read, a Bulletin upload), and some are
 * stray crumbs / exceptions that don't belong to a journey at all.
 */

import * as Sentry from "@sentry/react";
import type { Span } from "@sentry/react";

import { recordJourneyAttribute, scrubAttributes } from "./scrub.ts";

type AttrValue = string | number | boolean;

/**
 * Canonical Sentry `op` values for the non-journey spans we emit.
 * Centralised so the dashboard's `op` filter stays a closed set.
 */
export type SpanOp =
  | "chain.read"
  | "chain.write"
  | "bulletin.publish"
  | "host.call"
  | "registry.read";

/**
 * Wrap an async operation in a Sentry span. The span auto-ends when
 * the promise settles. `attributes` are scrubbed before they land on
 * the span. Errors propagate (Sentry tags the span via the SDK's
 * built-in error pathway).
 *
 * Use for one-shot async edges (chain reads, Bulletin uploads). Use
 * `JourneyTracker` for multi-step user-facing flows.
 */
export function withSpan<T>(
  name: string,
  op: SpanOp,
  fn: (span: Span) => Promise<T>,
  attributes?: Readonly<Record<string, AttrValue>>,
): Promise<T> {
  const scrubbed = scrubAttributes(attributes);
  return Sentry.startSpan({ name, op, attributes: scrubbed }, async (span) => {
    try {
      return await fn(span);
    } catch (caught) {
      // Re-throw so the caller's error handling runs. Sentry's
      // built-in span-error correlation picks up unhandled throws
      // when tracing is wired; we don't double-capture.
      throw caught;
    }
  });
}

/**
 * Emit a structured breadcrumb. `data` keys are scrubbed before they
 * reach Sentry. `category` defaults to `"app"` — both `"app"` and
 * `"telemetry"` are on the allow-list in `beforeBreadcrumb`.
 */
export function breadcrumb(
  message: string,
  data?: Readonly<Record<string, AttrValue>>,
  category: "app" | "telemetry" | "journey" = "app",
  level: "info" | "warning" | "error" = "info",
): void {
  const scrubbed = scrubAttributes(data);
  Sentry.addBreadcrumb({
    category,
    type: level === "error" ? "error" : "info",
    level,
    message,
    data: scrubbed,
  });
}

/**
 * Send an unhandled error to Sentry with scrubbed context. `tags` are
 * filtered through `recordJourneyAttribute` (so a tag named
 * `"merchantId"` is refused). `extras` are forwarded — they go on
 * `event.extra` and are filtered again by `beforeSend` as a defence
 * in depth.
 *
 * Use this inside `ErrorBoundary.componentDidCatch` and any catch
 * branch that swallows an error you still want to learn about.
 */
export function captureError(
  error: unknown,
  tags?: Readonly<Record<string, AttrValue>>,
  extras?: Readonly<Record<string, unknown>>,
): void {
  // Tag scrubbing is stricter than extra scrubbing — tags are
  // server-side indexed and show up everywhere. Extras are arbitrary
  // metadata only attached to the single event.
  const safeTags: Record<string, AttrValue> = {};
  if (tags) {
    for (const key of Object.keys(tags)) {
      const value = tags[key];
      if (value === undefined) continue;
      if (recordJourneyAttribute(key, value)) safeTags[key] = value;
    }
  }
  Sentry.captureException(error, {
    tags: safeTags,
    extra: extras as Record<string, unknown> | undefined,
  });
}

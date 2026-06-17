// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Privacy guards for telemetry instrumentation. w3spay handles money:
 * every attribute, breadcrumb, and event header crossing the Sentry
 * boundary is filtered here. Contract (docs/prds/w3spay.md): "Nobody who
 * isn't part of the transaction can tell that customer X paid shop Y."
 *
 *   - SENSITIVE_KEY_RE: deny pattern for identifier / address / amount /
 *     raw-payload / tx-hash keys.
 *   - MAX_ATTRIBUTE_LENGTH: refuse over-length string values (catches
 *     accidental SS58 / H160 / hex leaks).
 *   - beforeSend / beforeBreadcrumb: last-line scrubbers wired into
 *     Sentry.init — strip request metadata and drop the leaky default
 *     breadcrumb categories (xhr/fetch/navigation/console).
 *
 * Refusals always console.error but NEVER throw: telemetry is best-effort
 * and crashing the payment flow over a typo'd attribute key is the worse
 * failure mode.
 */

import type {
  Breadcrumb,
  BreadcrumbHint,
  ErrorEvent,
  EventHint,
} from "@sentry/react";

/**
 * Keys whose presence on a Sentry attribute / tag / breadcrumb data
 * field MUST trigger a refusal. Updated when a new PII vector lands.
 */
export const SENSITIVE_KEY_RE =
  /destination|merchant|terminal|payment_?id|tx_?hash|amount|kassen|raw|address|account|signer|wallet|public_?key|secret|email|phone|user_?id/i;

/**
 * Max forwarded attribute-string length. SS58 is 47 chars, H160 42, a TSE
 * deeplink hundreds; 32 fits categorical labels (e.g. "balance-low") while
 * catching any accidental address-literal leak.
 */
export const MAX_ATTRIBUTE_LENGTH = 32;


/**
 * Max forwarded exception-message length. Library errors we don't control
 * (PAPI dispatch, IPFS fetch, ethers ABI) can embed contract addresses,
 * calldata hex, and gateway URLs; 240 fits categorical messages and
 * truncates the runaway stringified-data tail.
 */
export const MAX_EXCEPTION_MESSAGE_LENGTH = 240;

/**
 * Substrings redacted from an exception message before it leaves the device,
 * each collapsed to a placeholder so the dashboard keeps the error SHAPE
 * without the payload. Ordered most-specific first (0x hex is the most
 * common leak vector).
 */
const EXCEPTION_REDACTORS: ReadonlyArray<readonly [RegExp, string]> = [
  // 0x-prefixed hex blobs, ≥ 8 chars. Catches H160 (40), AccountId32
  // (64), tx hash (64), and any calldata fragment.
  [/0x[0-9a-fA-F]{8,}/g, "0x«hex»"],
  // SS58 — base58 string starting with 1-9 (no leading zero) with the
  // length range Polkadot uses (47-49 chars). Crude but precise enough.
  [/\b[1-9A-HJ-NP-Za-km-z]{45,50}\b/g, "«ss58»"],
  // CIDs — start with `bafy` (CIDv1) or `Qm` (CIDv0).
  [/\b(?:bafy[0-9a-z]+|Qm[1-9A-HJ-NP-Za-km-z]{44})\b/g, "«cid»"],
  // Full URLs (any scheme). Keeps the scheme so the dashboard knows
  // whether it was an http or ws failure.
  [/(https?|wss?):\/\/[^\s"']+/g, "$1://«url»"],
];

/** Run the redactors + length cap over an exception message. Pure. */
export function sanitizeExceptionMessage(message: string): string {
  let out = message;
  for (const [pattern, replacement] of EXCEPTION_REDACTORS) {
    out = out.replace(pattern, replacement);
  }
  if (out.length > MAX_EXCEPTION_MESSAGE_LENGTH) {
    out = `${out.slice(0, MAX_EXCEPTION_MESSAGE_LENGTH)}…`;
  }
  return out;
}

/** Categorical / numeric / boolean values are the only thing we accept. */
type JourneyAttrPrimitive = string | number | boolean;

/**
 * Validate a single key/value before it lands on a Sentry attribute. Returns
 * false (with a logged refusal) for unsafe pairs. The refusal NEVER throws —
 * telemetry is best-effort and must not crash the host app.
 */
export function recordJourneyAttribute(
  key: string,
  value: JourneyAttrPrimitive,
): boolean {
  if (SENSITIVE_KEY_RE.test(key)) {
    refuse(`refused attribute "${key}" (matches SENSITIVE_KEY_RE)`);
    return false;
  }
  if (typeof value === "string" && value.length > MAX_ATTRIBUTE_LENGTH) {
    refuse(
      `refused attribute "${key}" — value length ${value.length} > ${MAX_ATTRIBUTE_LENGTH}`,
    );
    return false;
  }
  return true;
}

/**
 * Filtered copy of `attributes`: drops keys matching SENSITIVE_KEY_RE and
 * over-length string values. Logs a console.error on refusal; never throws.
 */
export function scrubAttributes(
  attributes: Readonly<Record<string, JourneyAttrPrimitive>> | undefined,
): Record<string, JourneyAttrPrimitive> {
  const out: Record<string, JourneyAttrPrimitive> = {};
  if (!attributes) return out;
  for (const key of Object.keys(attributes)) {
    const value = attributes[key];
    if (value === undefined) continue;
    if (recordJourneyAttribute(key, value)) out[key] = value;
  }
  return out;
}

// `Sentry.init({ beforeSend })` only fires for error events; transactions
// use the separate `beforeSendTransaction` hook (we don't install one
// because our spans are pre-scrubbed at the `JourneyTracker` layer).

/**
 * `Sentry.init({ beforeSend })` hook. Strips identifying request metadata
 * and SENSITIVE_KEY_RE tag/extra keys. Never returns null — events must
 * still reach Sentry, just with the PII removed.
 */
export function beforeSend(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  // URL + query string can leak terminal id, kassen serial, or dest hex.
  const request = event.request;
  if (request) {
    delete request.url;
    delete request.query_string;
    const headers = request.headers;
    if (headers) {
      delete headers["Referer"];
      delete headers["referer"];
      delete headers["Cookie"];
      delete headers["cookie"];
    }
  }
  // User: IP / email / username all leak by design.
  const user = event.user;
  if (user) {
    delete user.ip_address;
    delete user.email;
    delete user.username;
  }
  // Tags: caller-supplied bag — drop sensitive keys outright.
  const tags = event.tags;
  if (tags) {
    for (const key of Object.keys(tags)) {
      if (SENSITIVE_KEY_RE.test(key)) delete tags[key];
    }
  }
  // Extra: free-form, same filter.
  const extra = event.extra;
  if (extra) {
    for (const key of Object.keys(extra)) {
      if (SENSITIVE_KEY_RE.test(key)) delete extra[key];
    }
  }
  // Exception messages: free-form strings from third-party code, the most
  // likely PII leak vector — run every value through the redactors.
  const exception = event.exception;
  if (exception?.values) {
    for (const value of exception.values) {
      if (typeof value.value === "string") {
        value.value = sanitizeExceptionMessage(value.value);
      }
    }
  }
  // The top-level `event.message` (set by `captureMessage`) gets the
  // same treatment.
  if (typeof event.message === "string") {
    event.message = sanitizeExceptionMessage(event.message);
  }
  return event;
}

/**
 * Allowed breadcrumb categories; anything else is dropped before reaching
 * Sentry. Default categories (console/xhr/fetch/navigation/ui.click) all leak:
 * a fetch URL carries the registry contract address, ui.click carries DOM
 * text like "Pay 4.20 CASH TOKEN to <merchant>". We add our own via breadcrumb().
 */
const ALLOWED_BREADCRUMB_CATEGORIES: ReadonlySet<string> = new Set([
  "journey",
  "telemetry",
  "app",
]);

/** `Sentry.init({ beforeBreadcrumb })` hook. Allow-list: drop anything we didn't emit. */
export function beforeBreadcrumb(
  breadcrumb: Breadcrumb,
  _hint?: BreadcrumbHint,
): Breadcrumb | null {
  const category = breadcrumb.category;
  if (category == null) return null;
  if (!ALLOWED_BREADCRUMB_CATEGORIES.has(category)) return null;
  return breadcrumb;
}

/**
 * Log a refusal via console.error. NEVER throws: attribute names sometimes
 * brush the regex by coincidence (e.g. `boot.merchant_table_source` contains
 * `merchant` but is a categorical source label, not an identifier), and
 * crashing the app over an observability false positive is far worse than
 * silently dropping the attribute.
 */
function refuse(message: string): void {
  console.error(`[telemetry/scrub] ${message}`);
}

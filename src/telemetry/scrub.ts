/**
 * Privacy guards for telemetry instrumentation.
 *
 * w3spay handles money — every attribute, breadcrumb, and event header
 * that crosses the Sentry boundary is filtered through this module.
 * The contract from `docs/prds/w3spay.md` is non-negotiable: "Nobody
 * who isn't part of the transaction can tell that customer X paid
 * shop Y."
 *
 * Three layers:
 *
 *   - `SENSITIVE_KEY_RE`: attribute / tag / breadcrumb-data key
 *     allow-deny pattern. Matches anything that smells like an
 *     identifier, address, amount, raw payload, or transaction hash.
 *   - `MAX_ATTRIBUTE_LENGTH`: any string value longer than this is
 *     refused (an SS58 address is 47 chars, a `0x...` H160 is 42, a
 *     raw QR text is hundreds — 32 catches all of them while still
 *     leaving room for category labels like
 *     `"merchant-table-loaded"`).
 *   - `beforeSend` / `beforeBreadcrumb`: last-line scrubbers wired into
 *     `Sentry.init`. They strip identifying request metadata, drop
 *     unsolicited breadcrumb categories (xhr/fetch/navigation/console
 *     are too leaky for a payments app), and remove tag/extra keys
 *     matching `SENSITIVE_KEY_RE`.
 *
 * Failure mode: `recordJourneyAttribute()` and `scrubAttributes()`
 * `console.error` on every refusal so a regression shows up in dev
 * logs immediately. The refusal NEVER throws — observability data
 * is best-effort; crashing the payment flow over a typo'd attribute
 * key is a worse failure mode than a missing data point. The loud
 * console.error is plenty to catch real bugs in dev.
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
 * Maximum string length for any attribute value we'll forward. SS58 is
 * 47 chars; H160 is 42; a TSE deeplink is hundreds. 32 is enough for
 * the categorical labels we actually want (e.g. `"balance-low"`,
 * `"register-merchant"`, `"tse-valid"`) and short enough to catch any
 * accidental address-literal leak.
 */
export const MAX_ATTRIBUTE_LENGTH = 32;


/**
 * Maximum exception-message length we forward to Sentry. Error
 * messages from libraries we don't control (PAPI dispatch, IPFS
 * fetch, ethers ABI) can embed contract addresses, calldata hex,
 * gateway URLs, and the like. 240 is enough for any reasonable
 * categorical message and short enough to truncate the runaway
 * stringified-data tail of a dispatch error.
 */
export const MAX_EXCEPTION_MESSAGE_LENGTH = 240;

/**
 * Patterns inside an exception message that MUST be redacted before
 * the event leaves the device. Each entry collapses the matched
 * substring to a fixed placeholder so the dashboard still shows the
 * SHAPE of the error without leaking the payload.
 *
 * Ordered most-specific first — `0x` hex blobs are the most common
 * leak vector (contract addresses, accountId hex, calldata, tx
 * hashes); SS58 strings come from the host SDK's chain-account
 * formatting; URLs come from `fetch` exceptions and IPFS gateways.
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

/**
 * Run the redactors + length cap over an exception message. Pure;
 * safe to call from anywhere. Used by `beforeSend` and exposed so
 * call sites that build their own error strings can sanitize too.
 */
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
 * Validate a single key/value before it lands on a Sentry attribute.
 * Returns `true` if the pair is safe to record, `false` (with a logged
 * refusal) otherwise.
 *
 * The refusal NEVER throws — it logs a loud `console.error` and the
 * attribute is dropped from anything that reaches Sentry. The journey
 * (or whatever call path) continues normally; telemetry is best-effort
 * and must not crash the host app.
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
 * Filtered copy of `attributes`: keys matching `SENSITIVE_KEY_RE` and
 * string values exceeding `MAX_ATTRIBUTE_LENGTH` are dropped. Logs
 * a loud `console.error` on the first refusal so callers see the
 * bug; the call site never throws.
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
 * `Sentry.init({ beforeSend })` hook. Strips identifying request
 * metadata, removes tag/extra keys matching `SENSITIVE_KEY_RE`, and
 * preserves everything else. Never returns `null` — events must still
 * reach Sentry for error/perf observability, just with the PII removed.
 */
export function beforeSend(
  event: ErrorEvent,
  _hint: EventHint,
): ErrorEvent | null {
  // Request metadata: URL + query string leak terminal id, kassen
  // serial, dest hex if any of those ever ended up in routing.
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
  // Exception messages: free-form strings from third-party code, the
  // most likely PII leak vector. Run every exception value through
  // the redactors so a dispatch error like
  // `transaction failed in block: 0x1234... merchant funkhaus`
  // becomes `transaction failed in block: 0x«hex» merchant funkhaus`.
  // The `merchant` token by itself isn't PII (it's a categorical
  // word); the customer-id values are what we care about, and those
  // are covered by the hex / ss58 redactors.
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
 * Allowed breadcrumb categories. Anything not in this set is dropped
 * before it reaches Sentry — default categories `console`, `xhr`,
 * `fetch`, `navigation`, `ui.click` all leak in subtle ways (a fetch
 * URL contains the registry contract address, console output can
 * contain a hex destination, `ui.click` carries DOM text that includes
 * "Pay 4.20 CASH to <merchant>"). We add our own breadcrumbs through
 * the typed `breadcrumb()` helper in `sentry-helpers.ts`.
 */
const ALLOWED_BREADCRUMB_CATEGORIES: ReadonlySet<string> = new Set([
  "journey",
  "telemetry",
  "app",
]);

/**
 * `Sentry.init({ beforeBreadcrumb })` hook. Allow-list: drop everything
 * we didn't explicitly emit.
 */
export function beforeBreadcrumb(
  breadcrumb: Breadcrumb,
  _hint?: BreadcrumbHint,
): Breadcrumb | null {
  const category = breadcrumb.category;
  if (category == null) return null;
  if (!ALLOWED_BREADCRUMB_CATEGORIES.has(category)) return null;
  return breadcrumb;
}

// ─── internal ───────────────────────────────────────────────────────

/**
 * Log a refusal. Always `console.error` so the offending key + reason
 * shows up in dev tools and in any captured-console transport — loud
 * enough to be impossible to miss in a test run.
 *
 * NEVER throws. An earlier version threw in DEV, on the theory that
 * an unfailable assert catches PII bugs at their first invocation.
 * Practice showed the opposite: telemetry attribute names sometimes
 * brush against the regex by coincidence (e.g. `boot.merchant_table_source`
 * contains the word `merchant` but carries the categorical source
 * label, not a merchant identifier), and crashing the app over an
 * observability false positive is much worse than silently dropping
 * the attribute. The combination of (a) loud console.error, (b)
 * categorical attribute dropped, and (c) the rest of the journey
 * continuing is the right balance — bugs surface in dev logs, and
 * the payment flow is never blocked by telemetry.
 */
function refuse(message: string): void {
  console.error(`[telemetry/scrub] ${message}`);
}

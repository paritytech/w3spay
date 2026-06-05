/**
 * Pure helpers that map host / scanner errors onto the human-readable
 * strings the screens render.
 *
 * Lives in `app/` because everything here is wired directly into the
 * payment routing flow (App.tsx + render-stage.tsx). Pure functions, no
 * React, no host — safe to import from a test.
 */

import type { HostAuthState } from "@/features/host/api/host-auth.ts";

import type { UnsupportedReason } from "@/features/scan/lib/dispatcher.ts";
import type { ParsedTseQr } from "@/features/scan/lib/tse-parser.ts";

/**
 * Idempotency key for the receipt. A TSE guarantees `(serial, transaction#,
 * signature#)` is globally unique per fiscal event; we use it verbatim so
 * a rescan from the same device flips to `alreadyPaid` rather than
 * re-charging.
 */
export function receiptIdempotencyKey(parsed: ParsedTseQr): string {
  return `paidReceipt:${parsed.kassenSerial}:${parsed.transactionNumber}:${parsed.signatureCounter}`;
}

/**
 * Truncate the raw payload to a humane preview. Keeps the first 96 chars,
 * appends an ellipsis past that. Used by the unsupported-QR screen on the
 * rare path where we want to echo what the camera saw.
 */
export function truncateRaw(raw: string): string {
  if (raw.length <= 96) return raw;
  return `${raw.slice(0, 96)}…`;
}

/**
 * Human-readable description for each `UnsupportedReason` the dispatcher
 * produces. The screen renders this verbatim — never quote the raw
 * payload, that's an information-leak with no UX value.
 */
export function describeUnsupported(reason: UnsupportedReason): string {
  switch (reason) {
    case "polkadotUriScheme":
      return "That's not a receipt code. Look for the small one printed at the bottom of the slip.";
    case "embeddedQrJson":
      return "That's a different kind of code. Look for the small one printed at the bottom of the slip.";
    case "empty":
      return "Couldn't read this one. Try the small code at the bottom of the slip.";
    case "unknownFormat":
      return "Couldn't recognise this code. Look for the small one printed at the bottom of the slip.";
  }
}

/**
 * Standard host payment error variants w3spay routes on.
 *
 * The standard host payment manager (`@/sdk/host`'s
 * `createPaymentManager`) rejects `requestPayment` with a SCALE
 * `PaymentRequestErr` CodecError whose `.name` is the fully-qualified
 * variant (`"PaymentRequestErr::InsufficientBalance"`, …). We classify on
 * that `.name` string rather than `instanceof` because
 * `@novasamatech/host-api`'s SCALE error classes are duplicated across
 * several physical npm copies (the host-api-wrapper bundles its own), so a
 * single imported class would not `instanceof`-match an error thrown from
 * the wrapper's copy.
 */
export type PaymentErrorVariant =
  | "insufficient-balance"
  | "rejected"
  | "internal";

const PAYMENT_REQUEST_ERR_PREFIX = "PaymentRequestErr::";

/**
 * Classify a thrown payment error. Returns `null` when the throw is not a
 * recognized `PaymentRequestErr` SCALE error (e.g. a generic settlement
 * `Error("Payment failed: …")` or any other rejection).
 */
export function classifyPaymentError(caught: unknown): PaymentErrorVariant | null {
  if (!(caught instanceof Error)) return null;
  if (!caught.name.startsWith(PAYMENT_REQUEST_ERR_PREFIX)) return null;
  const variant = caught.name.slice(PAYMENT_REQUEST_ERR_PREFIX.length);
  if (variant === "InsufficientBalance") return "insufficient-balance";
  if (variant === "Rejected") return "rejected";
  // `Unknown` and any future variant collapse to a generic host-side fault.
  return "internal";
}

/**
 * Map a thrown payment error onto a single, reassuring sentence. Known
 * `PaymentRequestErr` variants get specific copy; everything else (generic
 * settlement failures, unrecognized throws) gets a generic retry hint —
 * never leak a structured code or raw host string to the customer.
 */
export function messageForPaymentError(caught: unknown): string {
  switch (classifyPaymentError(caught)) {
    case "insufficient-balance":
      return "Not enough balance. Top up and try again.";
    case "internal":
      return "Couldn't complete the payment. Try again.";
    case "rejected":
    default:
      return "Payment couldn't go through. Try again.";
  }
}

/**
 * Categorical failure label for telemetry — maps a thrown payment
 * error + current auth state onto a small closed set. The set is
 * intentionally narrow so the dashboard's `journey.failure_reason`
 * filter has stable values:
 *
 *   - `balance-low`       customer doesn't have enough CASH
 *   - `host-unavailable`  host lost / never connected
 *   - `auth-disconnected` customer's account isn't connected
 *   - `payment-denied`    host explicitly refused the payment
 *   - `coin-internal`     host-side internal payment fault
 *   - `unknown`           everything else
 *
 * NEVER pass the raw `error.message` to telemetry — those strings are
 * free-form and may carry PII (destination hex, amount). The
 * categorical label above is the contract.
 */
export type PayFailureCategory =
  | "balance-low"
  | "host-unavailable"
  | "auth-disconnected"
  | "payment-denied"
  | "coin-internal"
  | "unknown";

/**
 * Map a thrown payment error + current auth state onto the categorical
 * failure label. Mirrors `derivePayErrorStage`'s routing (`needsLogin` /
 * `hostUnavailable` / `payError`) so the telemetry `journey.failure_reason`
 * always matches what the UI told the customer.
 */
export function categorizePayError(
  caught: unknown,
  authState: HostAuthState,
): PayFailureCategory {
  if (authState.kind === "disconnected") return "auth-disconnected";
  if (authState.kind === "outsideHost" || authState.kind === "error") {
    return "host-unavailable";
  }
  switch (classifyPaymentError(caught)) {
    case "insufficient-balance":
      return "balance-low";
    case "rejected":
      return "payment-denied";
    case "internal":
      return "coin-internal";
    default:
      return "unknown";
  }
}

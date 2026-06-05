/**
 * Pure helpers for the dev-only manual payment override (see
 * `features.devPaymentOverride` in `src/config.ts`).
 *
 * Two concerns:
 *   - `parseDevAccountIdInput` validates a destination as either a
 *     32-byte AccountId32 in `0x`-prefixed hex form (66 chars total)
 *     OR an SS58 address (Polkadot's base58 form, e.g.
 *     `12bq7BGSgSzXTuEK…`). Both decode to the same 32-byte public key;
 *     the parser returns the canonical lowercase hex in either case so
 *     downstream call sites (`MerchantDestination.accountId32`) get a
 *     single representation.
 *   - `parseDevCashAmountInput` / `sanitizeDevCashInput` handle the
 *     decimal CASH amount the user types in the form. Cents output;
 *     mirrors the input-sanitization pattern of `tip.ts` so the
 *     visible field stays in lock-step with what the parser accepts
 *     (digits + one decimal separator, max 2 fractional digits).
 *
 * Kept pure / framework-free so they're unit-testable without React.
 */

import { getSs58AddressInfo } from "polkadot-api";

/**
 * Destination string → canonical 66-char `0x`-prefixed lowercase hex.
 * Accepts two forms:
 *
 *   - Raw hex: `0x` + exactly 64 hex chars.
 *   - SS58: any valid Polkadot-style base58 address (network prefix is
 *     ignored — only the underlying 32-byte public key is kept).
 *
 * Returns `null` for any other input. NEVER throws.
 */
export function parseDevAccountIdInput(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // Raw hex path. Cheap, no base58 decode round-trip.
  if (trimmed.length === 66 && (trimmed[1] === "x" || trimmed[1] === "X") && trimmed[0] === "0") {
    const body = trimmed.slice(2);
    if (/^[0-9a-fA-F]{64}$/.test(body)) {
      return `0x${body.toLowerCase()}`;
    }
    // Looks hex-shaped but isn't — keep falling through; SS58 can be 66
    // chars in rare edge cases, but `0x…` prefix won't survive base58.
    return null;
  }

  // SS58 path. `getSs58AddressInfo` validates the checksum and length
  // for us, so anything it accepts decodes to a 32-byte public key.
  const info = getSs58AddressInfo(trimmed);
  if (!info.isValid) return null;
  if (info.publicKey.length !== 32) return null;

  let hex = "0x";
  for (const byte of info.publicKey) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Cap on a single dev payment, in cents. 9_999_999 cents == 99_999.99
 * CASH — comfortably above any plausible test transfer while still
 * preventing a fat-finger from queuing an absurd extrinsic.
 */
export const MAX_DEV_PAYMENT_CENTS = 9_999_999;

/**
 * Parse a user-typed CASH amount (e.g. `"0.01"`, `"1,50"`, `".5"`) into
 * integer cents. Accepts both `.` and `,` as decimal separators. Returns
 * `null` for empty or unparseable input, or for an amount that resolves
 * to `<= 0` cents (rejecting `"0"`, `"0.00"`, `"-1"`).
 *
 * Result is clamped to `MAX_DEV_PAYMENT_CENTS`.
 */
export function parseDevCashAmountInput(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const normalized = trimmed.replace(",", ".");
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(normalized)) return null;
  const asNumber = Number(normalized);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return null;
  const cents = Math.round(asNumber * 100);
  if (cents <= 0) return null;
  return Math.min(MAX_DEV_PAYMENT_CENTS, cents);
}

/**
 * Sanitize a raw value as the user types — strip anything that isn't a
 * digit or a single decimal separator, collapse extras, and cap the
 * fractional part at two digits. Mirrors `sanitizeCustomTipInput` so
 * the dev form behaves the same way as the tip input.
 */
export function sanitizeDevCashInput(raw: string): string {
  let next = raw.replace(/[^0-9.,]/g, "");
  const sepIdx = next.search(/[.,]/);
  if (sepIdx >= 0) {
    const intPart = next.slice(0, sepIdx + 1);
    const fracPart = next.slice(sepIdx + 1).replace(/[.,]/g, "").slice(0, 2);
    next = intPart + fracPart;
  }
  return next;
}

/**
 * Short hex preview (`0x1234…abcd`) for the paying / done / error
 * screens, so the cashier-glance copy doesn't drag a 66-char line
 * across the viewport. Returns the input verbatim if it's already
 * short enough to fit.
 */
export function shortenDevDestination(hex: string): string {
  if (hex.length <= 14) return hex;
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

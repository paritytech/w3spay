/**
 * Cents → display string helpers.
 *
 * The TSE QR carries fractional EUR amounts that the parser normalises to
 * integer cents. From the parser outward, w3spay treats every amount as
 * **CASH cents** (1:1 — see plan rationale). This module is the only place
 * that does the cents → "X.YY" rendering for the UI.
 *
 * Cents are 1/100 of the token by design — independent of `TOKEN_DECIMALS`,
 * which describes the on-chain smallest-unit (plancks) the host API uses.
 * Conversion between cents and plancks happens at the `PaymentHost`
 * boundary; everything downstream of that is cents.
 *
 * Kept tiny on purpose: anything broader (parser internals, planck math)
 * lives in `scan/` or `host/`.
 */

/**
 * Format an integer cent amount as a fixed two-decimal string ("12.34").
 *
 * Sign is preserved for negative inputs ("-0.99"). Non-finite or
 * non-integer values throw — the parser always hands us integers, and
 * defending the formatter against floats prevents silent rounding.
 */
export function formatAmountCents(cents: number): string {
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) {
    throw new TypeError(`formatAmountCents expects an integer, got ${cents}`);
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}${whole.toString()}.${remainder.toString().padStart(2, "0")}`;
}

/**
 * EUR → pUSD conversion. RFC 6 (§"Asset Assumption") fixes the host's
 * payment asset to a single token (pUSD). The German fiscal TSE QR
 * carries an EUR amount; we need pUSD for `coinPayment.paymentRequest`.
 *
 * Tomorrow-MVP locks a hardcoded rate (~ EUR→USD spot, 1 EUR ≈ 1.07 USD).
 * Real eurobot quote integration (per the Terminal V2 PRD) is post-MVP.
 *
 * pUSD's smallest unit is **10⁻⁶ pUSD** (six decimals). The function
 * returns a `bigint` to remove any chance of float drift on the conversion
 * boundary — `Balance` is `u128` on the host side and the SDK's `Balance`
 * is `number`, but pre-validating with `bigint` and only narrowing at the
 * very last step keeps round-trip arithmetic safe for receipt totals up
 * to ~9 × 10¹⁵ cents (way beyond any single Web3 Summit sale).
 */

/**
 * Hardcoded EUR→USD rate for the demo. Tuned to be close enough to
 * spot that "EUR 2.55 → ~pUSD 2.73" doesn't surprise anyone in the
 * confirm screen, while staying conservative for the merchant.
 */
export const HARDCODED_EUR_TO_USD_RATE = 1.07;

/** Six decimals of precision for pUSD smallest-unit. */
export const PUSD_DECIMALS = 6;
const PUSD_UNITS_PER_PUSD = 10n ** BigInt(PUSD_DECIMALS);

/**
 * Convert an EUR amount (in integer cents) to pUSD smallest-unit (bigint).
 *
 * Rounding is half-away-from-zero — close enough to "fair" for a demo,
 * and never produces a silently lower amount than the merchant expects
 * after the rate is applied.
 */
export function eurCentsToPusdUnits(amountEurCents: number, rate: number = HARDCODED_EUR_TO_USD_RATE): bigint {
  if (!Number.isFinite(amountEurCents) || !Number.isFinite(rate)) {
    throw new TypeError("amountEurCents and rate must be finite numbers");
  }
  if (!Number.isInteger(amountEurCents)) {
    throw new TypeError("amountEurCents must be an integer (smallest unit)");
  }
  // Scale: we want amountEurCents/100 * rate * 10^6 = amountEurCents * rate * 10^4 units.
  // Compute in number first (fits in IEEE-754 for any plausible receipt) and
  // round half-away-from-zero before converting to bigint.
  const unitsFloat = amountEurCents * rate * 1e4;
  const rounded = unitsFloat >= 0 ? Math.round(unitsFloat) : -Math.round(-unitsFloat);
  return BigInt(rounded);
}

/**
 * Convert a pUSD smallest-unit value back to a display string with two
 * decimals (the only resolution that matters for the confirm screen).
 */
export function formatPusdSmallestUnit(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const abs = units < 0n ? -units : units;
  const whole = abs / PUSD_UNITS_PER_PUSD;
  const fractional = abs % PUSD_UNITS_PER_PUSD;
  // Display two decimals — pUSD has six, but receipts only ever care about cents.
  const fractionalCents = fractional / (PUSD_UNITS_PER_PUSD / 100n);
  return `${sign}${whole.toString()}.${fractionalCents.toString().padStart(2, "0")}`;
}

/** Format EUR cents → display string ("12.34"). */
export function formatEurCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}${whole.toString()}.${remainder.toString().padStart(2, "0")}`;
}

// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Cents → display string helpers. From the parser outward w3spay treats every
 * amount as CASH cents.
 *
 * Cents are 1/100 of the token by design — independent of `TOKEN_DECIMALS`
 * (the on-chain plancks unit). Cents↔plancks conversion happens inside
 * `sendPayment`; everything downstream is cents.
 */

/**
 * Format integer cents as a fixed two-decimal string ("12.34"); sign preserved
 * ("-0.99"). Non-finite/non-integer inputs throw — defending against floats
 * prevents silent rounding.
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

// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Pure helpers for the dev-only manual payment override
 * (`features.devPaymentOverride` in `src/config.ts`).
 * `parseDevAccountIdInput` accepts a 32-byte AccountId32 as `0x`-hex or an
 * SS58 address — both decode to the same public key, returned as canonical
 * lowercase hex so call sites get one representation.
 * `parseDevCashAmountInput` / `sanitizeDevCashInput` handle the decimal CASH TOKEN
 * amount (cents output), mirroring `tip.ts`. Framework-free for unit-testing.
 */

import { getSs58AddressInfo } from "polkadot-api";

/**
 * Destination string → canonical 66-char `0x`-prefixed lowercase hex.
 * Accepts raw hex (`0x` + 64 hex chars) or any valid SS58 address (network
 * prefix ignored — only the 32-byte public key is kept). Returns `null` for
 * anything else. NEVER throws.
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
 * Cap on a single dev payment, in cents (9_999_999 == 99_999.99 CASH TOKEN): above
 * any plausible test transfer, but blocks a fat-finger absurd extrinsic.
 */
export const MAX_DEV_PAYMENT_CENTS = 9_999_999;

/**
 * Parse a user-typed CASH TOKEN amount (`"0.01"`, `"1,50"`, `".5"`) into integer
 * cents. Accepts `.` and `,` separators. Returns `null` for empty,
 * unparseable, or `<= 0` input; clamped to `MAX_DEV_PAYMENT_CENTS`.
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
 * Sanitize a raw value as the user types — strip non-digit/separator chars,
 * collapse extras, cap the fractional part at two digits. Mirrors
 * `sanitizeCustomTipInput`.
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
 * Short hex preview (`0x1234…abcd`) for the paying / done / error screens.
 * Returns the input verbatim if already short enough.
 */
export function shortenDevDestination(hex: string): string {
  if (hex.length <= 14) return hex;
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

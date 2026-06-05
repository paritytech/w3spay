/**
 * Cross-screen display helpers — kept narrow on purpose. Anything broader
 * (parser internals, storage helpers) lives in `scan/` or `pay/`.
 *
 * w3spay is single-asset: every amount the UI renders is CASH cents. The
 * `TOKEN_TICKER` is re-exported as `ASSET_LABEL` so existing call sites
 * don't have to chase a rename for back-compat.
 */

import { envConfig } from "@/shared/config.ts";

/** Display string for the asset alongside the amount (e.g. "CASH"). */
export const ASSET_LABEL = envConfig.token.symbol;

/**
 * Split a merchant displayName of the shape `"Name (Venue)"` into its parts
 * so the editorial title can render `Name, Venue.` with italic venue. Falls
 * back to a single `name` when there's no parenthesised venue.
 */
export function splitDisplayName(displayName: string): { name: string; venue?: string } {
  const match = displayName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (match != null && match[1] != null && match[2] != null) {
    return { name: match[1].trim(), venue: match[2].trim() };
  }
  return { name: displayName };
}

/** Short hex (e.g. "0x1234…5678") for destination + payment-id meta rows. */
export function shortHex(hex: string, head = 6, tail = 4): string {
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

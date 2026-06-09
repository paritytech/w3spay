// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Narrow cross-screen display helpers. w3spay is single-asset: every rendered
 * amount is CASH cents. `ASSET_LABEL` re-exports `TOKEN_TICKER` for back-compat.
 */

import { envConfig } from "@/config";

/** Display string for the asset alongside the amount (e.g. "CASH"). */
export const ASSET_LABEL = envConfig.token.symbol;

/** Split `"Name (Venue)"` into name + optional venue for the editorial title. */
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

/** Format an ISO timestamp into compact `{ date: "9 Jun", time: "21:33" }` parts. */
export function formatHistoryDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "—" };
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = `${d.getDate()} ${months[d.getMonth()]}`;
  const time = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  return { date, time };
}

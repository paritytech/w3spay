// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import { envConfig } from "@/config";
import {
  PARAM,
  parseSaveReceiptParams,
  type ParsedReceipt,
} from "@/features/scan/lib/receipt-parser.ts";
import { getTerminalStore } from "@/features/host/lib/terminal-store.ts";
import { saveReceipt } from "@/features/wallet/api/receipts.ts";
import { useSessionStore } from "@/features/payment/store/session-store.ts";
import { PATHS } from "@/app/router/routes.ts";

export interface SaveReceiptDeepLink {
  readonly receipt: ParsedReceipt;
  /** The raw `?…` query (incl. leading `?`) the payload was parsed from. */
  readonly query: string;
}

/**
 * Find a save-receipt payload in a launch URL's `search` and/or `hash`. Keys on
 * `id`+`v` presence (the receipt signature), not the path, so it works whether
 * the host delivers the query as `?…` or inside a `#/save-receipt?…` fragment.
 * A malformed payload returns `null` (logged) so the app still boots.
 */
export function findSaveReceiptDeepLink(
  search: string,
  hash: string,
): SaveReceiptDeepLink | null {
  const candidates: string[] = [];
  if (search.length > 1) candidates.push(search);
  const hashQuery = hash.indexOf("?");
  if (hashQuery >= 0) candidates.push(hash.slice(hashQuery));
  for (const query of candidates) {
    const params = new URLSearchParams(query);
    if (!params.has(PARAM.saleId) || !params.has(PARAM.version)) continue;
    try {
      return { receipt: parseSaveReceiptParams(params), query };
    } catch (caught) {
      console.warn("[w3spay/deeplink] malformed save-receipt payload", caught);
      return null;
    }
  }
  return null;
}

/**
 * Persist a save-receipt payload locally and seed the `receiptSaved` flow so
 * the receipt-saved route renders it. Idempotent on `saleId` (`saveReceipt`
 * dedupes), so re-running on a repeat open is harmless. Shared by the cold-start
 * consumer and the warm-navigation route guard.
 */
export function persistSaveReceipt(found: SaveReceiptDeepLink): void {
  void saveReceipt(getTerminalStore(), {
    receipt: found.receipt,
    savedAt: new Date().toISOString(),
    rawQrText: `polkadotapp://${envConfig.host.productDotNs}/#/save-receipt${found.query}`,
  });
  useSessionStore.getState().setFlow({ kind: "receiptSaved", receipt: found.receipt });
}

/**
 * Consume a save-receipt deep link from the live `window.location` at COLD
 * start: persist the receipt, seed the `receiptSaved` flow, and rewrite the URL
 * to the receipt-saved hash route. Must run BEFORE the hash history reads the
 * initial location so the router boots on `receiptSaved` and a reload won't
 * re-fire. No-op when the launch URL carries no payload.
 */
export function consumeSaveReceiptDeepLink(): void {
  if (typeof window === "undefined") return;
  const found = findSaveReceiptDeepLink(window.location.search, window.location.hash);
  if (found === null) return;
  persistSaveReceipt(found);
  history.replaceState(null, "", `${window.location.pathname}#${PATHS.receiptSaved}`);
}

/**
 * Warm-navigation counterpart to `consumeSaveReceiptDeepLink` (which only runs
 * once at cold start): when the host changes the hash on an already-loaded SPA
 * to `#/save-receipt?…`, the `/save-receipt` route's `beforeLoad` calls this.
 * Reads the live URL, persists + seeds the flow when it carries a receipt, and
 * reports whether it did — the route redirects to the receipt-saved
 * confirmation on `true`, the scan index on `false`.
 */
export function persistSaveReceiptFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  const found = findSaveReceiptDeepLink(window.location.search, window.location.hash);
  if (found === null) return false;
  persistSaveReceipt(found);
  return true;
}

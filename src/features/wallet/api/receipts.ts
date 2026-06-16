// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Local saved-receipts store — KvStore-backed list of every `t3rminal-receipt`
 * QR scanned and saved on this device. Read by `WalletScreen`, written by the
 * scan flow when a receipt deeplink is saved. A record-keeping artifact
 * independent of the crypto payment flow. Storage envelope:
 *
 *   key:   `RECEIPTS_KEY` (currently "w3spay:receipts:v1")
 *   value: JSON.stringify({ schemaVersion, entries: ReceiptRecord[] })
 *
 * Newest-first, capped at `RECEIPTS_MAX_ENTRIES`. `saveReceipt` dedupes on
 * `saleId` so a rescan refreshes the entry to the top rather than duplicating.
 * Schema-version bumps drop the previous envelope on read (no migration); all
 * writes are best-effort and never throw.
 */

import { envConfig } from "@/config";
import type { KvStore } from "@/shared/utils/kv-store.ts";
import type { ParsedReceipt } from "@/features/scan/lib/receipt-parser.ts";

const RECEIPTS_KEY = envConfig.storage.receiptsKey;
const RECEIPTS_MAX_ENTRIES = envConfig.storage.receiptsMaxEntries;
const RECEIPTS_SCHEMA_VERSION = envConfig.storage.receiptsSchemaVersion;

export { RECEIPTS_KEY };

export interface ReceiptRecord {
  /** The parsed receipt — nested so the ~12 receipt fields aren't duplicated. */
  readonly receipt: ParsedReceipt;
  /** Wall-clock when we saved the scan, ISO string. */
  readonly savedAt: string;
  /**
   * Verbatim QR text scanned. Optional — lets the detail view re-render the
   * original code into a scannable SVG. Absent on records written before raw
   * text was captured.
   */
  readonly rawQrText?: string;
}

interface ReceiptsEnvelope {
  schemaVersion: typeof RECEIPTS_SCHEMA_VERSION;
  entries: ReceiptRecord[];
}

export async function readReceipts(store: KvStore | null): Promise<ReceiptRecord[]> {
  if (store == null) return [];
  const raw = await store.get(RECEIPTS_KEY).catch(() => null);
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(raw) as ReceiptsEnvelope;
    if (parsed.schemaVersion !== RECEIPTS_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries;
  } catch {
    return [];
  }
}

export async function saveReceipt(
  store: KvStore | null,
  record: ReceiptRecord,
): Promise<void> {
  if (store == null) return;
  const existing = await readReceipts(store);
  // Dedupe by saleId: a rescan drops the prior copy and prepends the fresh one,
  // so the newest scan floats to the top instead of stacking duplicates.
  const deduped = existing.filter((r) => r.receipt.saleId !== record.receipt.saleId);
  const next = [record, ...deduped].slice(0, RECEIPTS_MAX_ENTRIES);
  const envelope: ReceiptsEnvelope = {
    schemaVersion: RECEIPTS_SCHEMA_VERSION,
    entries: next,
  };
  try {
    await store.set(RECEIPTS_KEY, JSON.stringify(envelope));
  } catch {
    // Best-effort — a write failure must never block the receipt-saved UI.
  }
}

/** Sum of an item's `unitPriceCents × quantity`, in cents. */
export function itemLineTotalCents(item: { unitPriceCents: number; quantity: number }): number {
  return item.unitPriceCents * item.quantity;
}

/**
 * Tax included in a gross (tax-inclusive) amount, in integer cents. Receipts
 * carry only `taxRatePercent`, so the saved-receipt screen backs the tax out of
 * the gross subtotal to show a Tax line. `taxRatePercent` is a percent
 * (19 → 19%); a non-positive or non-finite rate yields 0.
 */
export function receiptTaxCents(grossCents: number, taxRatePercent: number): number {
  if (!Number.isFinite(grossCents) || !Number.isInteger(grossCents)) {
    throw new TypeError(`receiptTaxCents expects integer cents, got ${grossCents}`);
  }
  if (!(taxRatePercent > 0)) return 0;
  return grossCents - Math.round(grossCents / (1 + taxRatePercent / 100));
}

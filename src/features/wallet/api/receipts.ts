/**
 * Local saved-receipts store — KvStore-backed list of every
 * `t3rminal-receipt` QR the customer has scanned and saved on this
 * device. Read by `WalletScreen` (Receipts tab), written by
 * `stage-context.tsx#handleDecoded` when a receipt scan lands.
 *
 * This is a record-keeping artifact, independent of the crypto payment
 * flow — a digital copy of a printed purchase slip. It mirrors
 * `payment-history.ts`'s envelope shape exactly:
 *
 *   key:   `RECEIPTS_KEY` (currently "w3spay:receipts:v1")
 *   value: JSON.stringify({ schemaVersion, entries: ReceiptRecord[] })
 *
 * Entries are kept newest-first and capped at `RECEIPTS_MAX_ENTRIES`;
 * the oldest tail past the cap is trimmed. Re-scanning the same slip is
 * idempotent: `saveReceipt` dedupes on `saleId`, dropping the prior copy
 * and prepending the fresh one so a rescan refreshes the entry to the
 * top rather than duplicating it.
 *
 * Schema-version bumps drop the previous envelope on read — saved
 * receipts are a UI cache, not a fiscal record, so there is no
 * migration path. All writes are best-effort and never throw.
 */

import { envConfig } from "@/shared/config.ts";
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
   * Verbatim QR text the customer scanned. Optional — lets the detail
   * view re-render the original code into a scannable SVG. Absent on
   * records written before the raw text was available.
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
  // Dedupe by saleId: re-scanning the same slip drops the prior copy and
  // prepends the fresh one, so the newest scan wins and floats to the top
  // instead of stacking duplicates.
  const deduped = existing.filter((r) => r.receipt.saleId !== record.receipt.saleId);
  const next = [record, ...deduped].slice(0, RECEIPTS_MAX_ENTRIES);
  const envelope: ReceiptsEnvelope = {
    schemaVersion: RECEIPTS_SCHEMA_VERSION,
    entries: next,
  };
  try {
    await store.set(RECEIPTS_KEY, JSON.stringify(envelope));
  } catch {
    // Saved receipts are best-effort — a write failure must NEVER bubble
    // up and block the receipt-saved confirmation UI.
  }
}

/** Sum of an item's `unitPriceCents × quantity`, in cents. */
export function itemLineTotalCents(item: { unitPriceCents: number; quantity: number }): number {
  return item.unitPriceCents * item.quantity;
}

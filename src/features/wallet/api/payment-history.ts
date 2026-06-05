/**
 * Local payment history — KvStore-backed list of every successful payment
 * the customer has made through this device. Read by `WalletScreen`
 * (Activity tab), appended by `App.tsx#performPayment` on success.
 *
 * This is the local mirror of what the host's vault recorded. The host
 * still owns the canonical receipts; we keep a thin local index so the
 * customer can flip to "Activity" without waiting on a chain query.
 *
 * Storage envelope:
 *   key:   `PAYMENT_HISTORY_KEY` (currently "w3spay:payment-history:v2")
 *   value: JSON.stringify({ schemaVersion, entries: PaymentRecord[] })
 *
 * Entries are kept newest-first. Capped at `PAYMENT_HISTORY_MAX_ENTRIES`
 * — we trim the oldest tail past that. The local history is a UI
 * affordance, not a fiscal record; truncation is intentional.
 *
 * Schema version bumps drop the previous envelope on read — there is no
 * migration path. The history is a UI cache, not a fiscal record.
 */

import { envConfig } from "@/shared/config.ts";

const PAYMENT_HISTORY_KEY = envConfig.storage.paymentHistoryKey;
const PAYMENT_HISTORY_MAX_ENTRIES = envConfig.storage.paymentHistoryMaxEntries;
const PAYMENT_HISTORY_SCHEMA_VERSION = envConfig.storage.paymentHistorySchemaVersion;
import type { KvStore } from "@/shared/utils/kv-store.ts";

export { PAYMENT_HISTORY_KEY };

export interface PaymentRecord {
  /** Host-issued payment ID (RFC 0017). */
  paymentId: string;
  /**
   * 32-byte AccountId32 destination, lowercase `0x`-prefixed hex. The
   * actual address funds were sent to — captured at payment time so
   * the local history survives a registry rotation, and so the dev-pay
   * flow (which has no merchant directory entry) can still record the
   * minimal `(address, amount, date)` triple.
   */
  destination: string;
  /**
   * Total amount the host actually charged, in integer cents (TSE
   * subtotal + any tip on the merchant flow; raw amount on the dev
   * flow). Pre-tip entries (older shapes) match the subtotal — they
   * predate `tipCents`.
   */
  amountCents: number;
  /**
   * Tip in integer cents the customer added on top of the receipt
   * subtotal. Optional: the dev-pay path and pre-tip records skip it;
   * absent ⇒ "no tip".
   */
  tipCents?: number;
  /** Wall-clock at the time we recorded the success, ISO string. */
  paidAt: string;
  /**
   * Settlement state of this row.
   *  - `paid`         — host confirmed settlement.
   *  - `refunded`     — the customer-side flow flipped the row into refunded territory.
   *  - `unconfirmed`  — host accepted the payment request but the settlement
   *    subscription was interrupted before we observed a terminal status.
   *    Money may have moved on chain; reconcile via the host vault.
   */
  status: "paid" | "refunded" | "unconfirmed";
  /**
   * Merchant directory metadata captured at payment time. All optional
   * because the dev-pay path has no merchant entry — every required
   * field on this record is the (destination, amountCents, paidAt)
   * triple plus `paymentId` and `status`. Consumers MUST treat the
   * merchant block as best-effort context, not as a source of truth.
   */
  merchantDisplayName?: string;
  merchantId?: string;
  terminalId?: string;
  /** TSE receipt identifiers — let the user reconcile against the paper slip. */
  kassenSerial?: string;
  transactionNumber?: string;
  /**
   * Verbatim text decoded from the receipt QR. Optional — old records
   * and dev-pay records skip it; the receipt detail view hides its QR
   * section when this is absent.
   */
  rawQrText?: string;
}

interface HistoryEnvelope {
  schemaVersion: typeof PAYMENT_HISTORY_SCHEMA_VERSION;
  entries: PaymentRecord[];
}

export async function readPaymentHistory(store: KvStore | null): Promise<PaymentRecord[]> {
  if (store == null) return [];
  const raw = await store.get(PAYMENT_HISTORY_KEY).catch(() => null);
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(raw) as HistoryEnvelope;
    if (parsed.schemaVersion !== PAYMENT_HISTORY_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries;
  } catch {
    return [];
  }
}

export async function appendPayment(
  store: KvStore | null,
  record: PaymentRecord,
): Promise<void> {
  if (store == null) return;
  const existing = await readPaymentHistory(store);
  const next = [record, ...existing].slice(0, PAYMENT_HISTORY_MAX_ENTRIES);
  const envelope: HistoryEnvelope = {
    schemaVersion: PAYMENT_HISTORY_SCHEMA_VERSION,
    entries: next,
  };
  try {
    await store.set(PAYMENT_HISTORY_KEY, JSON.stringify(envelope));
  } catch {
    // History is best-effort — a write failure must NEVER bubble up and
    // block the payment success UI.
  }
}

/** Compact UI helpers for the wallet Activity panel. */

export function formatHistoryDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "—" };
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = `${d.getDate()} ${months[d.getMonth()]}`;
  const time = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  return { date, time };
}

/** Truncate a payment ID to "0xa8f1…29bc" form for the meta rows. */
export function shortPaymentId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/** Sum of all paid amounts, in cents. */
export function sumPaidCents(records: readonly PaymentRecord[]): number {
  let total = 0;
  for (const r of records) {
    if (r.status === "paid") total += r.amountCents;
  }
  return total;
}

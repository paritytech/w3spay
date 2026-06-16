// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Wallet overlay — the record-keeping surface reached from the scan / done
 * screens. Lists the saved `t3rminal-receipt` codes; the panel reads the local
 * KvStore via TanStack Query, so a save whose mutation invalidated the receipts
 * key shows up without manual refresh. Tapping a row opens the id-addressed
 * receipt detail route.
 */

import type { ReceiptRecord } from "@/features/wallet/api/receipts.ts";
import { useReceipts } from "@/features/wallet/api/queries.ts";
import { formatAmountCents } from "@/shared/utils/format-amount.ts";
import {
  Dotted,
  Eyebrow,
  Frame,
  Head,
  IconButton,
} from "@/shared/components/primitives.tsx";
import { formatHistoryDate, splitDisplayName } from "@/shared/utils/format.ts";

export interface WalletScreenProps {
  onBack: () => void;
  onOpenReceiptRecord: (record: ReceiptRecord) => void;
}

export function WalletScreen({ onBack, onOpenReceiptRecord }: WalletScreenProps) {
  return (
    <Frame>
      <div style={{ display: "flex", marginBottom: 6 }}>
        <IconButton onClick={onBack} label="Close" icon="x" />
      </div>

      <div className="wallet-panels">
        <div className="wallet-panel wallet-panel--active">
          <ReceiptsPanel onOpenRecord={onOpenReceiptRecord} />
        </div>
      </div>
    </Frame>
  );
}

interface ReceiptsPanelProps {
  onOpenRecord: (record: ReceiptRecord) => void;
}

function ReceiptsPanel({ onOpenRecord }: ReceiptsPanelProps) {
  const { data } = useReceipts();
  const records = data ?? null;
  const count = records?.length ?? 0;

  return (
    <>
      <Eyebrow>Saved on this device</Eyebrow>
      <div className="history__head">
        <Head size={40} italic>
          Receipts.
        </Head>
        <span className="history__total">
          {count} {count === 1 ? "receipt" : "receipts"}
        </span>
      </div>

      <Dotted style={{ marginTop: 18 }} />

      <div className="history__list">
        {records === null ? (
          <div className="history__empty">Loading…</div>
        ) : records.length === 0 ? (
          <div className="history__empty">No receipts yet. Scan a receipt code to save one.</div>
        ) : (
          records.map((r, i) => (
            <ReceiptRow
              key={`${r.receipt.saleId}-${i}`}
              record={r}
              divider={i < records.length - 1}
              onOpen={() => onOpenRecord(r)}
            />
          ))
        )}
      </div>
    </>
  );
}

interface ReceiptRowProps {
  record: ReceiptRecord;
  divider: boolean;
  onOpen: () => void;
}

function ReceiptRow({ record, divider, onOpen }: ReceiptRowProps) {
  const { receipt } = record;
  const { name, venue } = splitDisplayName(receipt.business.name);
  const { date, time } = formatHistoryDate(record.savedAt);
  const itemCount = receipt.items.length;
  return (
    <>
      <button type="button" className="history__row" onClick={onOpen}>
        <div>
          <div className="history__merchant">{name}</div>
          <div className="history__meta">
            {venue ? `${venue} · ` : ""}
            {date}, {time}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="history__amount">
            {formatAmountCents(receipt.amountCents)} {receipt.currency}
          </div>
          <div className="history__status">
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </div>
        </div>
      </button>
      {divider ? <Dotted style={{ margin: 0 }} /> : null}
    </>
  );
}

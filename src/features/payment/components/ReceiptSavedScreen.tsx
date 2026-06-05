/**
 * Receipt saved — a `t3rminal-receipt` QR was scanned and persisted to
 * the local saved-receipts store. Confirms the save and offers two next
 * steps: jump to the Receipts section, or scan again.
 *
 * Mirrors `AlreadyPaidScreen`'s single-message layout, with the
 * two-button footer pattern from `PaymentFailedScreen`. Independent of
 * the payment flow — the receipt is a record-keeping artifact, not a
 * charge.
 */

import type { ParsedReceipt } from "@/features/scan/lib/receipt-parser.ts";
import {
  Dotted,
  Eyebrow,
  Frame,
  Head,
  Icon,
  MetaRow,
  PrimaryButton,
  SecondaryButton,
  Sub,
} from "@/shared/components/primitives.tsx";
import { formatAmountCents } from "@/shared/utils/format-amount.ts";

export interface ReceiptSavedScreenProps {
  receipt: ParsedReceipt;
  /** Open the wallet overlay (the caller picks the Receipts tab). */
  onOpenWallet: () => void;
  /** Walk back to the camera for another scan. */
  onNewScan: () => void;
}

export function ReceiptSavedScreen({ receipt, onOpenWallet, onNewScan }: ReceiptSavedScreenProps) {
  return (
    <Frame
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <PrimaryButton onClick={onOpenWallet}>
            <Icon name="receipt" size={16} />
            View receipts
          </PrimaryButton>
          <SecondaryButton onClick={onNewScan}>
            <Icon name="scan" size={16} />
            New scan
          </SecondaryButton>
        </div>
      }
    >
      <Eyebrow tone="success">Saved</Eyebrow>
      <div style={{ marginTop: 14 }}>
        <Head size={44} suffix="saved.">
          Receipt
        </Head>
      </div>
      <Dotted style={{ marginTop: 22 }} />
      <Sub>We kept a copy on this device. Find it any time under Receipts.</Sub>
      <div style={{ flex: 1 }} />
      <Dotted />
      <dl style={{ margin: 0 }}>
        <MetaRow label="From" value={receipt.business.name} />
        <MetaRow
          label="Total"
          value={`${formatAmountCents(receipt.amountCents)} ${receipt.currency}`}
          mono
        />
      </dl>
      <div style={{ paddingBottom: 6 }} />
    </Frame>
  );
}

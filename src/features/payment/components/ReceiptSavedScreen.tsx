// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Receipt saved — a `t3rminal-receipt` QR was scanned and persisted to the
 * local saved-receipts store. A record-keeping artifact, not a charge.
 * Below the confirmation hero we render a compact preview of the saved record —
 * the business ("From") and then the shared `ReceiptBreakdown` (line items, then
 * a tax / subtotal / tip / total summary) — so the screen doubles as a "here's
 * what we kept" summary, in the same format as the full detail view. The preview
 * lives in its own scroll region because `.editorial-frame__body` clips overflow;
 * a long receipt scrolls rather than spilling past the sticky footer.
 */

import type { ParsedReceipt } from "@/features/scan/lib/receipt-parser.ts";
import { ReceiptBreakdown } from "@/features/wallet/components/ReceiptBreakdown.tsx";
import {
  Dotted,
  Eyebrow,
  Frame,
  Head,
  Icon,
  PrimaryButton,
  SecondaryButton,
} from "@/shared/components/primitives.tsx";

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

      <Dotted style={{ marginTop: 18 }} />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          paddingTop: 14,
        }}
      >
        <Eyebrow>From</Eyebrow>
        <div
          style={{
            marginTop: 6,
            fontFamily: "var(--font-serif)",
            fontSize: 20,
            lineHeight: 1.3,
            color: "var(--color-text-primary)",
          }}
        >
          {receipt.business.name}
        </div>

        <Dotted style={{ marginTop: 16 }} />

        <ReceiptBreakdown receipt={receipt} />

        <div style={{ paddingBottom: 6 }} />
      </div>
    </Frame>
  );
}

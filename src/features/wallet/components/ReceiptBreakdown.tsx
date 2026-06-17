// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Shared receipt money breakdown — itemised lines followed by a
 * subtotal / tip / total summary, in that fixed order. Rendered
 * identically by the saved-receipt confirmation (`ReceiptSavedScreen`) and the
 * full saved-receipt detail view (`ReceiptDetailScreen`) so both surfaces show
 * the same format. The caller supplies the leading `Dotted` divider; this owns
 * the dividers between items, the summary, and the total.
 *
 * `amountCents` is the grand total. The subtotal is `amountCents − tipCents`.
 * The Tip row appears only when the receipt carried a tip.
 */

import type { ParsedReceipt } from "@/features/scan/lib/receipt-parser.ts";
import { ReceiptLineItems } from "@/features/wallet/components/ReceiptLineItems.tsx";
import { Dotted, Eyebrow, MetaRow } from "@/shared/components/primitives.tsx";
import { formatAmountCents } from "@/shared/utils/format-amount.ts";
import { ASSET_LABEL } from "@/shared/utils/format.ts";

export interface ReceiptBreakdownProps {
  receipt: ParsedReceipt;
}

export function ReceiptBreakdown({ receipt }: ReceiptBreakdownProps) {
  const tipCents = receipt.tipCents ?? 0;
  const hasTip = tipCents > 0;
  const subtotalCents = receipt.amountCents - tipCents;

  return (
    <>
      {receipt.items.length > 0 ? (
        <>
          <Eyebrow>Items</Eyebrow>
          <ReceiptLineItems items={receipt.items} />
          <Dotted style={{ marginTop: 6 }} />
        </>
      ) : null}

      <dl style={{ margin: "8px 0 0" }}>
        <MetaRow
          label="Subtotal"
          value={`${formatAmountCents(subtotalCents)} ${ASSET_LABEL}`}
          mono
        />
        {hasTip ? (
        <MetaRow label="Tip" value={`${formatAmountCents(tipCents)} ${ASSET_LABEL}`} mono />
        ) : null}
      </dl>

      <Dotted />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          padding: "10px 0",
          gap: 12,
        }}
      >
        <span
          style={{
            color: "var(--color-text-muted)",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          Total
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 18,
            color: "var(--color-text-primary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatAmountCents(receipt.amountCents)} {ASSET_LABEL}
        </span>
      </div>
    </>
  );
}

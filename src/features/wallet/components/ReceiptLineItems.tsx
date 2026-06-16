// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Itemised receipt lines — one row per purchased item: name, `qty × unit price`
 * caption, and the line total. Shared by the saved-receipt confirmation
 * (`ReceiptSavedScreen`) and the full saved-receipt detail view
 * (`ReceiptDetailScreen`) so both render line items identically. Renders
 * nothing for an empty list — callers gate the surrounding section header.
 */

import type { ReceiptItem } from "@/features/scan/lib/receipt-parser.ts";
import { itemLineTotalCents } from "@/features/wallet/api/receipts.ts";
import { formatAmountCents } from "@/shared/utils/format-amount.ts";

export interface ReceiptLineItemsProps {
  items: readonly ReceiptItem[];
  currency: string;
}

export function ReceiptLineItems({ items, currency }: ReceiptLineItemsProps) {
  return (
    <div style={{ margin: "8px 0 0" }}>
      {items.map((item, i) => (
        <div
          key={`${item.name}-${i}`}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            padding: "8px 0",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 15,
                color: "var(--color-text-primary)",
              }}
            >
              {item.name}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--color-text-muted)",
                letterSpacing: "0.04em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {item.quantity} × {formatAmountCents(item.unitPriceCents)} {currency}
            </div>
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              color: "var(--color-text-secondary)",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {formatAmountCents(itemLineTotalCents(item))} {currency}
          </div>
        </div>
      ))}
    </div>
  );
}

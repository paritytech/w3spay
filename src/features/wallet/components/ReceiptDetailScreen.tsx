// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Saved-receipt detail view (tap a row on Receipts). Renders the full purchase
 * — business header, issue time, the shared `ReceiptBreakdown` (line items, then
 * a tax / subtotal / tip / total summary, same format as the receipt-saved
 * screen), and block / merchant references.
 *
 * The footer "save as PNG" goes through the Web Share API on mobile (so the OS
 * offers "Save Image" → Photos) and a download on desktop. See
 * `util/save-receipt-image.ts`.
 */

import { useCallback, useState } from "react";

import { type ReceiptRecord } from "@/features/wallet/api/receipts.ts";
import { ReceiptBreakdown } from "@/features/wallet/components/ReceiptBreakdown.tsx";
import { useQrSvg } from "@/features/wallet/api/qr-svg.ts";
import { saveReceiptImage } from "@/shared/utils/save-receipt-image.ts";
import { Dotted, Eyebrow, Frame, Head, Icon, IconButton, SecondaryButton } from "@/shared/components/primitives.tsx";
import { formatHistoryDate, splitDisplayName } from "@/shared/utils/format.ts";

export interface ReceiptDetailScreenProps {
  record: ReceiptRecord;
  onBack: () => void;
}

export function ReceiptDetailScreen({ record, onBack }: ReceiptDetailScreenProps) {
  const qrSvg = useQrSvg(record.rawQrText);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const { receipt } = record;


  const { business } = receipt;
  const { name, venue } = splitDisplayName(business.name);
  const { date, time } = formatHistoryDate(receipt.issuedAt);
  const hasAddress = Boolean(business.addressLine1 || business.addressLine2 || business.phone);

  const handleSave = useCallback(() => {
    if (saving) return;
    setSaving(true);
    setSaveError(false);
    saveReceiptImage(record, qrSvg).then(
      () => setSaving(false),
      (err: unknown) => {
        console.warn("[w3spay/receipt] save image failed", err);
        setSaving(false);
        setSaveError(true);
        setTimeout(() => setSaveError(false), 3000);
      },
    );
  }, [saving, record, qrSvg]);

  return (
    <Frame
      footer={
        <SecondaryButton onClick={handleSave} disabled={saving}>
          <Icon name="image" size={16} />
          {saving ? "Saving…" : saveError ? "Try again" : "Save image"}
        </SecondaryButton>
      }
    >
      <div style={{ display: "flex", marginBottom: 6 }}>
        <IconButton onClick={onBack} label="Back" icon="chevron-left" />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <Eyebrow>Receipt</Eyebrow>
        <div style={{ marginTop: 14 }}>
          <Head size={34} suffix={venue ? `${venue}.` : undefined}>
            {venue ? `${name},` : name}
          </Head>
        </div>
        {hasAddress ? (
          <div
            style={{
              marginTop: 6,
              color: "var(--color-text-tertiary)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {business.addressLine1 ? <div>{business.addressLine1}</div> : null}
            {business.addressLine2 ? <div>{business.addressLine2}</div> : null}
            {business.phone ? (
              <div style={{ fontVariantNumeric: "tabular-nums" }}>{business.phone}</div>
            ) : null}
          </div>
        ) : null}
        <div
          style={{
            marginTop: 4,
            color: "var(--color-text-tertiary)",
            fontSize: 13,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
          }}
        >
          {date} · {time}
        </div>

        <Dotted style={{ marginTop: 18, marginBottom: 6 }} />

        <ReceiptBreakdown receipt={receipt} />

        <Dotted />

        <div style={{ paddingBottom: 12 }} />
      </div>
    </Frame>
  );
}

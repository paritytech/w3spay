/**
 * Saved-receipt detail view reached by tapping a row on the Receipts
 * screen. Renders the full purchase: business name / address / phone,
 * issue time, total + currency + tax rate, the itemised lines, and the
 * block / merchant references — plus, when the record carries the raw QR
 * text, the original `t3rminal-receipt` code rendered back into a
 * scannable SVG.
 *
 * A sticky footer button lets the customer save the receipt as a PNG
 * image. On iOS/Android this goes through the Web Share API so the OS
 * offers "Save Image" (→ camera roll / Photos); on desktop it triggers a
 * download. See `util/save-receipt-image.ts` for the canvas renderer.
 */

import { useCallback, useState } from "react";

import { formatAmountCents } from "@/shared/utils/format-amount.ts";
import { formatHistoryDate } from "@/features/wallet/api/payment-history.ts";
import { itemLineTotalCents, type ReceiptRecord } from "@/features/wallet/api/receipts.ts";
import { useQrSvg } from "@/features/wallet/api/qr-svg.ts";
import { saveReceiptImage } from "@/shared/utils/save-receipt-image.ts";
import { Dotted, Eyebrow, Frame, Head, Icon, IconButton, MetaRow, SecondaryButton } from "@/shared/components/primitives.tsx";
import { shortHex, splitDisplayName } from "@/shared/utils/format.ts";

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
      <div style={{ position: "absolute", top: 60, right: 18, zIndex: 4 }}>
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

        <div className="receipt-amount">
          <div className="receipt-amount__value">
            {formatAmountCents(receipt.amountCents)}
            <span className="receipt-amount__ticker"> {receipt.currency}</span>
          </div>
          <div className="receipt-amount__breakdown">incl. {receipt.taxRatePercent}% tax</div>
        </div>

        <Dotted style={{ marginTop: 6 }} />

        <Eyebrow>Items</Eyebrow>
        <div style={{ margin: "8px 0 0" }}>
          {receipt.items.map((item, i) => (
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
                  {item.quantity} × {formatAmountCents(item.unitPriceCents)} {receipt.currency}
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
                {formatAmountCents(itemLineTotalCents(item))} {receipt.currency}
              </div>
            </div>
          ))}
        </div>

        <Dotted />

        {qrSvg ? (
          <>
            <div className="receipt-qr">
              <div
                className="receipt-qr__svg"
                aria-label="Original receipt code"
                role="img"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <p className="receipt-qr__caption">The code from the printed slip.</p>
            </div>
            <Dotted />
          </>
        ) : null}

        <Eyebrow>Receipt details</Eyebrow>
        <dl style={{ margin: "8px 0 0" }}>
          <MetaRow label="Sale ID" value={receipt.saleId} mono />
          {receipt.blockNumber != null ? (
            <MetaRow label="Block" value={`#${receipt.blockNumber}`} mono />
          ) : null}
          {receipt.merchantAddress ? (
            <MetaRow label="Merchant" value={shortHex(receipt.merchantAddress)} mono />
          ) : null}
        </dl>
        <div style={{ paddingBottom: 12 }} />
      </div>
    </Frame>
  );
}

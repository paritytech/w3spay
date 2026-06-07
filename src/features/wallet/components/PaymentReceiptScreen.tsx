/**
 * Receipt detail view reached by tapping a row on the Activity screen.
 *
 * Renders the recorded merchant / amount / timestamp, the structured
 * receipt identifiers (terminal, merchant, kassen, …) and — when the
 * record carries the raw QR text — the original code itself, rendered
 * back into a scannable SVG so the user can show the slip on screen.
 */


import { formatAmountCents } from "@/shared/utils/format-amount.ts";
import {
  formatHistoryDate,
  type PaymentRecord,
} from "@/features/wallet/api/payment-history.ts";
import { useQrSvg } from "@/features/wallet/api/qr-svg.ts";
import {
  Dotted,
  Eyebrow,
  Frame,
  Head,
  IconButton,
  MetaRow,
} from "@/shared/components/primitives.tsx";
import { ASSET_LABEL, shortHex, splitDisplayName } from "@/shared/utils/format.ts";

export interface PaymentReceiptScreenProps {
  record: PaymentRecord;
  onBack: () => void;
}

export function PaymentReceiptScreen({ record, onBack }: PaymentReceiptScreenProps) {
  const qrSvg = useQrSvg(record.rawQrText);

  // Fall back to the shortened destination when no merchant entry was
  // attached at write time (dev-pay records).
  const heading = record.merchantDisplayName ?? shortHex(record.destination);
  const { name, venue } = splitDisplayName(heading);
  const { date, time } = formatHistoryDate(record.paidAt);
  const isRefund = record.status === "refunded";
  const isUnconfirmed = record.status === "unconfirmed";
  const tipCents = record.tipCents ?? 0;
  const subtotalCents = record.amountCents - tipCents;
  const hasTip = tipCents > 0;

  return (
    <Frame>
      <div style={{ position: "absolute", top: 60, right: 18, zIndex: 4 }}>
        <IconButton onClick={onBack} label="Back" icon="chevron-left" />
      </div>

      <Eyebrow tone={isRefund ? "warn" : isUnconfirmed ? "warn" : "success"}>
        {isRefund ? "Refunded" : isUnconfirmed ? "Submitted" : "Paid"}
      </Eyebrow>
      <div style={{ marginTop: 14 }}>
        <Head size={36} suffix={venue ? `${venue}.` : undefined}>
          {venue ? `${name},` : name}
        </Head>
      </div>
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
          {formatAmountCents(record.amountCents)}
          <span className="receipt-amount__ticker"> {ASSET_LABEL}</span>
        </div>
        {hasTip ? (
          <div className="receipt-amount__breakdown">
            Subtotal {formatAmountCents(subtotalCents)} · Tip {formatAmountCents(tipCents)}
          </div>
        ) : null}
      </div>

      <Dotted style={{ marginTop: 6 }} />

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
        <MetaRow label="Destination" value={shortHex(record.destination)} mono />
        <MetaRow label="Payment" value={shortHex(record.paymentId)} mono />
        {record.transactionNumber ? (
          <MetaRow label="Receipt" value={`#${record.transactionNumber}`} mono />
        ) : null}
        {record.terminalId ? <MetaRow label="Till" value={record.terminalId} mono /> : null}
        {record.merchantId ? <MetaRow label="Merchant" value={record.merchantId} mono /> : null}
        {record.kassenSerial ? <MetaRow label="TSE serial" value={record.kassenSerial} mono /> : null}
      </dl>
      <div style={{ paddingBottom: 12 }} />
    </Frame>
  );
}

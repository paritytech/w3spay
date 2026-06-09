// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/** Pre-pay review screen. */

import { formatAmountCents } from "@/shared/utils/format-amount.ts";
import type { ParsedTseQr } from "@/features/scan/lib/tse-parser.ts";
import {
  Dotted,
  Eyebrow,
  Frame,
  Head,
  MetaRow,
  PrimaryButton,
  SecondaryButton,
  Step,
} from "@/shared/components/primitives.tsx";
import {
  ASSET_LABEL,
  splitDisplayName,
} from "@/shared/utils/format.ts";

export interface ConfirmScreenProps {
  merchantDisplayName: string;
  /** Durable merchant handle from the on-chain registry. */
  merchantId: string;
  terminalId: string;
  parsed: ParsedTseQr;
  /** Tip in cents; 0 when the customer skipped or picked the 0% preset. */
  tipCents: number;
  /** Display string for the resolved destination (hex). */
  destinationDisplay: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmScreen({
  merchantDisplayName,
  terminalId,
  parsed,
  tipCents,
  onConfirm,
  onCancel,
}: ConfirmScreenProps) {
  const subtotalCents = parsed.amountCents;
  const totalCents = subtotalCents + tipCents;
  const subtotal = formatAmountCents(subtotalCents);
  const tipDisplay = formatAmountCents(tipCents);
  const total = formatAmountCents(totalCents);
  const { name, venue } = splitDisplayName(merchantDisplayName);
  const hasTip = tipCents > 0;
  const tipPercent = hasTip ? Math.round((tipCents / Math.max(subtotalCents, 1)) * 100) : 0;

  return (
    <Frame
      footer={
        <div className="btn-row">
          <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
          <PrimaryButton onClick={onConfirm}>
            Pay {total} {ASSET_LABEL}
          </PrimaryButton>
        </div>
      }
    >
      <Step n={3} of={3} label="Review payment" />

      <div style={{ marginTop: 14 }}>
        <Head size={36} suffix={venue ? `${venue}.` : undefined}>
          {venue ? `${name},` : name}
        </Head>
      </div>
      <div style={{ color: "var(--color-text-muted)", fontSize: 12, marginTop: 6, letterSpacing: "0.04em" }}>
        Till{" "}
        <span style={{ color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}>{terminalId}</span>
      </div>

      <Dotted style={{ marginTop: 16, marginBottom: 6 }} />

      <div className="amount-cluster">
        <Eyebrow>{hasTip ? "Total" : "Receipt total"}</Eyebrow>
        <div className="amount-cluster__amount">
          {total} <span className="amount-cluster__ticker">{ASSET_LABEL}</span>
        </div>
        {hasTip ? (
          <p className="amount-cluster__breakdown">
            Subtotal {subtotal} · Tip {tipDisplay}
            <span className="amount-cluster__breakdown-pct"> · {tipPercent}%</span>
          </p>
        ) : null}
      </div>

      <Dotted style={{ marginTop: 4, marginBottom: 4 }} />

      <dl style={{ margin: 0 }}>
        <MetaRow label="Receipt" value={`#${parsed.transactionNumber}`} mono />
        {hasTip ? <MetaRow label="Tip" value={`${tipDisplay} ${ASSET_LABEL}`} mono /> : null}
      </dl>
    </Frame>
  );
}

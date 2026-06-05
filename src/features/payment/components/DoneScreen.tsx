/**
 * Cashier-facing confirmation screen — editorial layout. The oversize
 * CASH number is the cashier-glance affordance; everything else is
 * structured receipt detail.
 */

import { formatAmountCents } from "@/shared/utils/format-amount.ts";
import type { ParsedTseQr } from "@/features/scan/lib/tse-parser.ts";
import {
  Dotted,
  Eyebrow,
  Frame,
  Icon,
  IconButton,
  MetaRow,
  PrimaryButton,
} from "@/shared/components/primitives.tsx";
import {
  ASSET_LABEL,
  splitDisplayName,
} from "@/shared/utils/format.ts";

export interface DoneScreenProps {
  merchantDisplayName: string;
  terminalId: string;
  parsed: ParsedTseQr;
  /**
   * Tip in cents the customer added on the tip screen. The cashier-glance
   * amount is `parsed.amountCents + tipCents` so what you see here is
   * what actually moved through the host.
   */
  tipCents: number;
  paymentId: string;
  /**
   * Host-reported settlement outcome.
   *  - `settled`     — terminal `completed` status observed; "Paid".
   *  - `unconfirmed` — host accepted the request but the settlement
   *    subscription was interrupted; the row reads "Submitted" and the
   *    sub copy invites the user to check Activity to reconcile.
   */
  settlement: "settled" | "unconfirmed";
  onAcknowledge: () => void;
  /** Open the wallet overlay (defaults to the Activity tab in the caller). */
  onOpenWallet?: () => void;
}

export function DoneScreen({
  merchantDisplayName,
  terminalId,
  parsed,
  tipCents,
  paymentId: _paymentId,
  settlement,
  onAcknowledge,
  onOpenWallet,
}: DoneScreenProps) {
  const isUnconfirmed = settlement === "unconfirmed";
  const totalCents = parsed.amountCents + tipCents;
  const amount = formatAmountCents(totalCents);
  const { name, venue } = splitDisplayName(merchantDisplayName);
  const date = new Date(parsed.logTime || parsed.startTime);
  const dateLabel = Number.isNaN(date.getTime())
    ? "—"
    : `${date.getDate()} ${date.toLocaleString("en", { month: "short" })} ${date.getFullYear()} · ${date
        .getHours()
        .toString()
        .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;

  return (
    <Frame
      footer={
        <PrimaryButton onClick={onAcknowledge}>
          <Icon name="scan" size={16} />
          New scan
        </PrimaryButton>
      }
    >
      <header className="done-header">
        <div className="done-stamp" aria-hidden="true">
          <Icon name="check" size={30} strokeWidth={2.25} color="currentColor" />
        </div>
        <div style={{ flex: 1 }}>
          <Eyebrow tone={isUnconfirmed ? "warn" : "success"}>
            {isUnconfirmed ? "Submitted" : "Paid"}
          </Eyebrow>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              color: "var(--color-text-tertiary)",
              fontSize: 14,
              marginTop: 4,
            }}
          >
            {isUnconfirmed
              ? "settlement pending — check Activity to reconcile."
              : "show this to the cashier."}
          </div>
        </div>
        {onOpenWallet ? <IconButton onClick={onOpenWallet} label="Activity" icon="history" /> : null}
      </header>

      <Dotted style={{ marginTop: 18 }} />

      <div style={{ textAlign: "left", marginTop: 8 }}>
        <div className="done-amount">
          {amount} <span className="done-amount__ticker">{ASSET_LABEL}</span>
        </div>
        <div className="done-recipient">
          to {name}
          {venue ? (
            <>
              ,<br />
              at {venue}.
            </>
          ) : (
            "."
          )}
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <Dotted />
      <dl style={{ margin: 0 }}>
        <MetaRow label="Receipt" value={`#${parsed.transactionNumber}`} mono />
        <MetaRow label="Till" value={terminalId} mono />
        <MetaRow label="Time" value={dateLabel} />
      </dl>
      <div style={{ paddingBottom: 4 }} />
    </Frame>
  );
}

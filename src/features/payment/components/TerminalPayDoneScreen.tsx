// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Settlement confirmation screen for the terminal-pay deeplink flow.
 */

import type { ParsedTerminalPayQr } from "@/features/scan/lib/terminal-pay-parser.ts";
import { formatAmountCents } from "@/shared/utils/format-amount.ts";
import {
  Dotted,
  Eyebrow,
  Frame,
  Icon,
  IconButton,
  MetaRow,
  PrimaryButton,
} from "@/shared/components/primitives.tsx";
import { ASSET_LABEL, splitDisplayName } from "@/shared/utils/format.ts";

export interface TerminalPayDoneScreenProps {
  qr: ParsedTerminalPayQr;
  /** Resolved from registry, or qr.terminalId when lookup failed. */
  merchantDisplayName: string;
  settlement: "settled" | "unconfirmed";

  onAcknowledge: () => void;
  onOpenWallet?: () => void;
}

/** Show first 8 + last 4 chars with an ellipsis for long IDs (e.g. SS58 terminal IDs). */
function truncateId(id: string, head = 8, tail = 4): string {
  return id.length > head + tail + 1 ? `${id.slice(0, head)}…${id.slice(-tail)}` : id;
}

export function TerminalPayDoneScreen({
  qr,
  merchantDisplayName,
  settlement,
  onAcknowledge,
  onOpenWallet,
}: TerminalPayDoneScreenProps) {
  const isUnconfirmed = settlement === "unconfirmed";
  const amount = formatAmountCents(qr.amountCents);
  const { name, venue } = splitDisplayName(merchantDisplayName);

  const now = new Date();
  const dateLabel = `${now.getDate()} ${
    now.toLocaleString("en", { month: "short" })
  } ${now.getFullYear()} · ${
    now.getHours().toString().padStart(2, "0")
  }:${now.getMinutes().toString().padStart(2, "0")}`;

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
              ? "settlement pending."
              : "show this to the cashier."}
          </div>
        </div>
        {onOpenWallet ? (
          <IconButton onClick={onOpenWallet} label="Receipts" icon="history" />
        ) : null}
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
        <MetaRow label="Terminal" value={truncateId(qr.terminalId)} mono />
        <MetaRow label="Time" value={dateLabel} />
      </dl>
      <div style={{ paddingBottom: 4 }} />
    </Frame>
  );
}

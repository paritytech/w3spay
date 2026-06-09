// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Pre-pay review screen for the terminal-pay deeplink flow.
 */

import type { ParsedTerminalPayQr } from "@/features/scan/lib/terminal-pay-parser.ts";
import { formatAmountCents } from "@/shared/utils/format-amount.ts";
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
import { ASSET_LABEL, splitDisplayName } from "@/shared/utils/format.ts";

export interface TerminalPayConfirmScreenProps {
  qr: ParsedTerminalPayQr;
  /** Resolved from registry, or qr.terminalId when lookup failed. */
  merchantDisplayName: string;
  terminalId: string;
  /** Destination display string — registry address value or qr.addressSs58. */
  destinationDisplay: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Show first 8 + last 4 chars with an ellipsis for long IDs (e.g. SS58 terminal IDs). */
function truncateId(id: string, head = 8, tail = 4): string {
  return id.length > head + tail + 1 ? `${id.slice(0, head)}…${id.slice(-tail)}` : id;
}

export function TerminalPayConfirmScreen({
  qr,
  merchantDisplayName,
  terminalId,
  onConfirm,
  onCancel,
}: TerminalPayConfirmScreenProps) {
  const total = formatAmountCents(qr.amountCents);
  const { name, venue } = splitDisplayName(merchantDisplayName);
  const shortId = truncateId(terminalId);

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
      <Step n={2} of={2} label="Review payment" />

      <div style={{ marginTop: 14 }}>
        <Head size={36} suffix={venue ? `${venue}.` : undefined}>
          {venue ? `${name},` : name}
        </Head>
      </div>
      <div
        style={{
          color: "var(--color-text-muted)",
          fontSize: 12,
          marginTop: 6,
          letterSpacing: "0.04em",
        }}
      >
        Till{" "}
        <span
          style={{ color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}
        >
          {shortId}
        </span>
      </div>
      <Dotted style={{ marginTop: 16, marginBottom: 6 }} />

      <div className="amount-cluster">
        <Eyebrow>Amount</Eyebrow>
        <div className="amount-cluster__amount">
          {total} <span className="amount-cluster__ticker">{ASSET_LABEL}</span>
        </div>
      </div>

      <Dotted style={{ marginTop: 4, marginBottom: 4 }} />

      <dl style={{ margin: 0 }}>
        <MetaRow label="Terminal" value={shortId} mono />
      </dl>
    </Frame>
  );
}

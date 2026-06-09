// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Merchant not in pilot — the scanned TSE serial wasn't in the merchant
 * registry table resolved at boot. Registry health is surfaced by the top
 * banner; this screen stays on the customer outcome: this till isn't
 * payable in w3spay right now.
 */

import {
  Dotted,
  Eyebrow,
  Frame,
  Head,
  Icon,
  PrimaryButton,
  Sub,
} from "@/shared/components/primitives.tsx";

export interface NotInPilotScreenProps {
  onNewScan: () => void;
}

export interface UnknownMerchantCopy {
  /** Small uppercase tag at the top of the frame. */
  readonly eyebrow: string;
  /** Bold-italic head body (everything before the `suffix`). */
  readonly headLead: string;
  /** Head suffix rendered tertiary. */
  readonly headSuffix: string;
  /** Paragraph below the dotted divider. */
  readonly sub: string;
}

/**
 * Pure helper keeping the "not in pilot" copy stable regardless of the
 * table's source. Registry health is communicated only by the top banner.
 */
export function unknownMerchantCopy(): UnknownMerchantCopy {
  return {
    eyebrow: "Not yet",
    headLead: "This place isn't",
    headSuffix: "on W3S Receipts yet.",
    sub:
      "This till hasn't joined the W3S Receipts pilot. Pay another way today, and check back soon.",
  };
}

export function NotInPilotScreen({ onNewScan }: NotInPilotScreenProps) {
  const copy = unknownMerchantCopy();
  return (
    <Frame
      footer={
        <PrimaryButton onClick={onNewScan}>
          <Icon name="scan" size={16} />
          New scan
        </PrimaryButton>
      }
    >
      <Eyebrow>{copy.eyebrow}</Eyebrow>
      <div style={{ marginTop: 14 }}>
        <Head size={44} suffix={copy.headSuffix}>
          {copy.headLead}
        </Head>
      </div>
      <Dotted style={{ marginTop: 22 }} />
      <Sub>{copy.sub}</Sub>
      <div style={{ flex: 1 }} />
      {/* No serial echo — humans don't need the till identifier. */}
    </Frame>
  );
}

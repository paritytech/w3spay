/**
 * Merchant not in pilot — the scanned TSE serial didn't appear in the
 * merchant registry table we resolved at boot. Registry health is now
 * surfaced only via the top banner; this screen stays focused on the
 * customer-facing outcome: this till is not payable in w3spay right now.
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
 * Pure helper that keeps the "not in pilot" copy stable regardless of
 * whether the merchant table came from chain, a cache hit, or no registry
 * data at all. Registry health is communicated only by the top banner.
 */
export function unknownMerchantCopy(): UnknownMerchantCopy {
  return {
    eyebrow: "Not yet",
    headLead: "This place isn't",
    headSuffix: "on W3sPay yet.",
    sub:
      "This till hasn't joined the W3sPay pilot. Pay another way today, and check back soon.",
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

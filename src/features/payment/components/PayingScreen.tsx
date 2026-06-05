/**
 * Paying — interstitial during `host.paymentRequest`. Shows the running
 * total in CASH and a calming spinner; no actions.
 */

import { Dotted, Eyebrow, Frame, Head, MetaRow, Sub } from "@/shared/components/primitives.tsx";
import { Spinner } from "@/shared/components/Spinner.tsx";
import { ASSET_LABEL, splitDisplayName } from "@/shared/utils/format.ts";
import { formatAmountCents } from "@/shared/utils/format-amount.ts";

export interface PayingScreenProps {
  /** Total amount being paid, in cents (subtotal + tip). */
  amountCents: number;
  merchantDisplayName: string;
}

export function PayingScreen({ amountCents, merchantDisplayName }: PayingScreenProps) {
  const amount = formatAmountCents(amountCents);
  const { name } = splitDisplayName(merchantDisplayName);
  return (
    <Frame>
      <Eyebrow>Almost done</Eyebrow>
      <div style={{ marginTop: 14 }}>
        <Head size={56} italic>
          Paying.
        </Head>
      </div>
      <Dotted style={{ marginTop: 18 }} />
      <Sub>
        Hold tight — we're moving the money. This usually takes a few{" "}
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-primary)" }}>seconds</span>.
      </Sub>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
        <Spinner size={32} />
      </div>
      <dl style={{ padding: "14px 0 24px", margin: 0 }}>
        <MetaRow label="To" value={name} />
        <MetaRow label="Amount" value={`${amount} ${ASSET_LABEL}`} mono />
      </dl>
    </Frame>
  );
}

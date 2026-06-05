/**
 * Already paid — a re-scan of a receipt this device has already settled.
 * Idempotency cache hit; show the existing receipt id and a "new scan"
 * affordance.
 */

import type { ParsedTseQr } from "@/features/scan/lib/tse-parser.ts";
import {
  Dotted,
  Eyebrow,
  Frame,
  Head,
  Icon,
  MetaRow,
  PrimaryButton,
  Sub,
} from "@/shared/components/primitives.tsx";

export interface AlreadyPaidScreenProps {
  onNewScan: () => void;
  parsed: ParsedTseQr;
  existingPaymentId: string;
}

export function AlreadyPaidScreen({ onNewScan, parsed }: AlreadyPaidScreenProps) {
  return (
    <Frame
      footer={
        <PrimaryButton onClick={onNewScan}>
          <Icon name="scan" size={16} />
          New scan
        </PrimaryButton>
      }
    >
      <Eyebrow>Already paid</Eyebrow>
      <div style={{ marginTop: 14 }}>
        <Head size={44} suffix="paid.">
          Already
        </Head>
      </div>
      <Dotted style={{ marginTop: 22 }} />
      <Sub>This receipt was already paid on this device. Show the cashier the earlier payment.</Sub>
      <div style={{ flex: 1 }} />
      <Dotted />
      <dl style={{ margin: 0 }}>
        <MetaRow label="Receipt" value={`#${parsed.transactionNumber}`} mono />
      </dl>
      <div style={{ paddingBottom: 6 }} />
    </Frame>
  );
}

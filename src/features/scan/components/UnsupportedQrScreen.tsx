/**
 * Unsupported QR — the scanner read a code that isn't a TSE receipt
 * (e.g. a polkadotapp:// deeplink or a JSON-encoded payload). Tells the
 * user to look for the small code at the bottom of the receipt slip.
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

export interface UnsupportedScreenProps {
  onRetry: () => void;
  detected?: string;
  description: string;
}

export function UnsupportedQrScreen({ onRetry, description }: UnsupportedScreenProps) {
  return (
    <Frame
      footer={
        <PrimaryButton onClick={onRetry}>
          <Icon name="refresh-cw" size={16} />
          Retry
        </PrimaryButton>
      }
    >
      <Eyebrow>Different code</Eyebrow>
      <div style={{ marginTop: 14 }}>
        <Head size={44} suffix="kind of code.">
          A different
        </Head>
      </div>
      <Dotted style={{ marginTop: 22 }} />
      <Sub>{description}</Sub>
      <div style={{ flex: 1 }} />
      {/* No raw payload — the description tells the user what to do next. */}
    </Frame>
  );
}

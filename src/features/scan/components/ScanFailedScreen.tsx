/**
 * Scan failed — the camera read a TSE-shaped QR but parsing failed.
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

export interface ScanFailedScreenProps {
  onRetry: () => void;
  errorMessage: string;
}

export function ScanFailedScreen({ onRetry }: ScanFailedScreenProps) {
  return (
    <Frame
      footer={
        <PrimaryButton onClick={onRetry}>
          <Icon name="refresh-cw" size={16} />
          Retry
        </PrimaryButton>
      }
    >
      <Eyebrow tone="danger">Couldn't read</Eyebrow>
      <div style={{ marginTop: 14 }}>
        <Head size={44} suffix="that one." suffixTone="danger">
          Couldn't read
        </Head>
      </div>
      <Dotted style={{ marginTop: 22 }} />
      <Sub>
        The receipt might be too creased, faded, or out of focus. Try again with a steadier view.
      </Sub>
      <div style={{ flex: 1 }} />
      {/* Errors say what to do next — we never quote the raw decoder. */}
    </Frame>
  );
}

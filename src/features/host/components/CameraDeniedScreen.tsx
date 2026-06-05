/**
 * Camera permission denied — host-level camera grant is missing.
 * The user must allow camera access in the Polkadot app and retry.
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

export interface CameraDeniedScreenProps {
  onRetry: () => void;
  message?: string;
}

export function CameraDeniedScreen({ onRetry, message }: CameraDeniedScreenProps) {
  return (
    <Frame
      footer={
        <PrimaryButton onClick={onRetry}>
          <Icon name="refresh-cw" size={16} />
          Retry
        </PrimaryButton>
      }
    >
      <Eyebrow tone="warn">Allow camera</Eyebrow>
      <div style={{ marginTop: 16 }}>
        <Head size={44} suffix="needed." suffixTone="warn">
          Camera
        </Head>
      </div>
      <Dotted style={{ marginTop: 22 }} />
      <Sub>
        {message ??
          "W3sPay reads codes off paper receipts — that's the whole product. Allow camera access and come back."}
      </Sub>
      <div style={{ flex: 1 }} />
      <div style={{ paddingBottom: 18, color: "var(--color-text-faint)", fontSize: 12, lineHeight: 1.6 }}>
        <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", color: "var(--color-text-tertiary)" }}>
          A note on privacy.{" "}
        </span>
        The camera feed never leaves your device. We only use the code on the page.
      </div>
    </Frame>
  );
}

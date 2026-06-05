/**
 * Boot error screen — shown when the initial balance fetch fails (e.g.
 * timeout, network hiccup, or an environment without a real payment
 * surface). Offers an explicit "Try again" button that re-triggers the
 * balance query so the user controls the retry cycle rather than watching
 * a spinner loop indefinitely.
 */

import { Dotted, Eyebrow, Frame, Head, PrimaryButton, Sub } from "@/shared/components/primitives.tsx";

export interface BootErrorScreenProps {
  message: string;
  onRetry: () => void;
}

export function BootErrorScreen({ message, onRetry }: BootErrorScreenProps) {
  return (
    <Frame
      footer={
        <PrimaryButton onClick={onRetry}>Try again</PrimaryButton>
      }
    >
      <Eyebrow tone="warn">Something went wrong</Eyebrow>
      <div style={{ marginTop: 16 }}>
        <Head size={44} suffix="connect.">
          Couldn't
        </Head>
      </div>
      <Dotted style={{ marginTop: 22 }} />
      <Sub>{message}</Sub>
      <div style={{ flex: 1 }} />
      <Dotted />
      <div
        style={{
          color: "var(--color-text-faint)",
          fontSize: 11,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          paddingBottom: 18,
        }}
      >
        Tap to retry
      </div>
    </Frame>
  );
}

/**
 * Host unavailable — shown when w3spay is running outside a Polkadot
 * host container or when the host signalled an unrecoverable failure.
 */

import { Dotted, Eyebrow, Frame, Head, Sub } from "@/shared/components/primitives.tsx";

export interface HostUnavailableScreenProps {
  message?: string;
}

export function HostUnavailableScreen({ message }: HostUnavailableScreenProps) {
  return (
    <Frame>
      <Eyebrow>Not here</Eyebrow>
      <div style={{ marginTop: 16 }}>
        <Head size={48} suffix="continue.">
          Open Polkadot to
        </Head>
      </div>
      <Dotted style={{ marginTop: 22 }} />
      <Sub>
        {message ??
          "W3sPay lives inside the Polkadot app. Open it there to keep going."}
      </Sub>
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
        No actions
      </div>
    </Frame>
  );
}

// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Unsupported platform gate — shown when opened in an environment not in
 * `envConfig.features.supportedPlatforms` (desktop browser, dot.li iframe,
 * Polkadot Desktop unless enabled). W3sPay targets the Polkadot Mobile native
 * webview only.
 */

import { Dotted, Eyebrow, Frame, Head, Sub } from "@/shared/components/primitives.tsx";

export function UnsupportedPlatformScreen() {
  return (
    <Frame>
      <Eyebrow>Not available here</Eyebrow>
      <div style={{ marginTop: 16 }}>
        <Head size={44} suffix="Mobile app.">
          Use Polkadot
        </Head>
      </div>
      <Dotted style={{ marginTop: 22 }} />
      <Sub>
        W3S Receipts is not supported on this platform at the moment. Open the
        Polkadot Mobile app on your phone to continue.
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
        Mobile only
      </div>
    </Frame>
  );
}

/**
 * Unsupported platform gate — shown when W3sPay is opened in an
 * environment not listed in `envConfig.features.supportedPlatforms`.
 *
 * Current unsupported contexts:
 *   - Desktop browser (pointer: fine, standalone)
 *   - dot.li web app (iframe)
 *   - Polkadot Desktop app, if not explicitly enabled
 *
 * The app is designed exclusively for the Polkadot Mobile native webview.
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
        W3sPay is not supported on this platform at the moment. Open the
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

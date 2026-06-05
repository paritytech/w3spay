/**
 * Render arbitrary text as a QR code SVG string.
 *
 * Used by the payment-receipt detail view to show the customer the same
 * code they scanned at the till. We pick the SVG output mode so the QR
 * stays sharp at any size and inherits the surrounding stone palette
 * without a raster intermediate.
 *
 * Light-on-dark would clash with the dark editorial chrome, so the QR
 * renders on its own warm-white card the way a paper slip would.
 */

import QRCode from "qrcode";

const QR_OPTIONS = {
  type: "svg",
  errorCorrectionLevel: "M",
  margin: 2,
  color: {
    dark: "#1c1917",
    light: "#fafaf9",
  },
} as const;

export async function renderQrSvg(text: string): Promise<string> {
  return QRCode.toString(text, QR_OPTIONS);
}

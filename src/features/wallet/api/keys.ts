// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Wallet-feature query keys. The payment mutations invalidate these so a fresh
 * write surfaces in the wallet without manual refresh wiring.
 */

export const walletKeys = {
  /** Local KvStore saved-receipts list (Receipts tab). */
  receipts: () => ["receipts"] as const,
  /** Rendered SVG for a raw receipt QR payload. */
  qrSvg: (rawQrText: string | null | undefined) => ["qr-svg", rawQrText] as const,
} as const;

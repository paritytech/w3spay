/**
 * Wallet-feature query keys.
 *
 * Read by the wallet queries (`usePaymentHistory`, `useReceipts`) and by
 * the payment mutations (`useAppendPayment`, `useSaveReceipt`) which
 * invalidate them so a fresh write surfaces in the wallet without manual
 * refresh wiring.
 */

export const walletKeys = {
  /** Local KvStore payment history mirror (Activity tab). */
  paymentHistory: () => ["payment-history"] as const,
  /** Local KvStore saved-receipts list (Receipts tab). */
  receipts: () => ["receipts"] as const,
  /** Rendered SVG for a raw receipt QR payload. */
  qrSvg: (rawQrText: string | null | undefined) => ["qr-svg", rawQrText] as const,
} as const;

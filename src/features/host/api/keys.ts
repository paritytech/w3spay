/**
 * Host-feature query keys.
 *
 * Functions (not bare arrays) so call sites can't drift on tuple shape.
 * Read by the host queries (`coin-payment-host`, `balance`) and by the
 * payment mutations that invalidate the balance after a successful pay.
 */

export const hostKeys = {
  /** Host payment-surface resolution poll. */
  coinPaymentHost: () => ["coin-payment-host"] as const,
  /** Spendable vault balance, in cents. Invalidated after every payment. */
  paymentBalance: () => ["payment-balance"] as const,
} as const;

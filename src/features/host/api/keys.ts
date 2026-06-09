// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Host-feature query keys. Functions (not bare arrays) so call sites can't
 * drift on tuple shape.
 */

export const hostKeys = {
  /** Host payment-surface resolution poll. */
  coinPaymentHost: () => ["coin-payment-host"] as const,
} as const;

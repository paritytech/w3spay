// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Test/dev seam for the cents-to-plancks payment send path.
 *
 * `PaymentManager` is the shape `sendPayment` drives — a slice of the
 * product-sdk host payment manager. The production resolver is in
 * `send-payment.ts`; this module exists so dev mode and tests can supply
 * their own manager without touching the SDK import surface.
 */

import type { PaymentStatus } from "@/shared/api/host";

export interface PaymentSubscription {
  unsubscribe(): void;
  onInterrupt(callback: (payload: unknown) => void): unknown;
}

export interface PaymentManager {
  requestPayment(plancks: bigint, destination: Uint8Array): Promise<{ id: string }>;
  subscribePaymentStatus(
    id: string,
    callback: (status: PaymentStatus) => void,
  ): PaymentSubscription;
}

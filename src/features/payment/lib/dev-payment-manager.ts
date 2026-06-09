// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Dev-only in-memory payment manager for standalone `vite dev` (no real
 * host). Tracks a planck balance and settles every request instantly; the
 * seed is large enough that any single QR-scan payment clears without a
 * top-up. State is lost on refresh and tree-shaken from production by the
 * `isDevStandalone()` gate at the call site.
 */

import { envConfig } from "@/config";
import type { PaymentManager, PaymentSubscription } from "@/features/payment/lib/payment-sender.ts";

let cached: PaymentManager | null = null;

/**
 * Lazy singleton — same instance across HMR re-renders so a successful
 * payment isn't reset when React re-runs the resolve `useMemo`.
 */
export function getDevPaymentManager(): PaymentManager {
  if (cached !== null) return cached;

  let balancePlancks = BigInt(envConfig.payment.devStartingBalancePlancks);
  let receiptCounter = 0;

  cached = {
    async requestPayment(plancks) {
      if (plancks > balancePlancks) {
        throw new Error(
          `dev reference manager: balance ${balancePlancks} plancks below requested ${plancks}`,
        );
      }
      balancePlancks -= plancks;
      receiptCounter += 1;
      return { id: `dev-${receiptCounter}` };
    },
    subscribePaymentStatus(_id, callback) {
      // Dev manager settles synchronously: every requestPayment succeeded by
      // the time we reach here, so emit `completed` on the next microtask.
      queueMicrotask(() => callback({ type: "completed" }));
      const subscription: PaymentSubscription = {
        unsubscribe() {},
        onInterrupt() {
          return () => {};
        },
      };
      return subscription;
    },
  };
  console.info(
    `[w3spay/dev] standalone reference PaymentManager installed (seed=${envConfig.payment.devStartingBalancePlancks} plancks)`,
  );
  return cached;
}

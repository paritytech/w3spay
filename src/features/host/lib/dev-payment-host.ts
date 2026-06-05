/**
 * Dev-only fallback payment host for `npm run dev:w3spay`.
 *
 * In production w3spay runs inside a Polkadot host which exposes the
 * standard product-sdk Host API; `createStandardPaymentHost` adapts it.
 * When running standalone (`vite dev`) there is no host, so we swap in a
 * tiny in-memory `PaymentHost` that tracks a planck balance and settles
 * every request instantly. The seed balance is large enough that any
 * single QR-scan payment clears without a top-up.
 *
 * State is denominated in **plancks** so the dev path matches the
 * planck-denominated wire on real hosts; the cents↔plancks boundary is
 * the same one `createStandardPaymentHost` uses. State is lost on page
 * refresh and tree-shaken out of production bundles by the
 * `isDevStandalone()` gate at the call site.
 */

import { envConfig } from "@/shared/config.ts";
import { safeNumberFromBigInt, type PaymentHost } from "@/features/host/lib/payment-host.ts";

let cached: PaymentHost | null = null;

/**
 * Lazy singleton — returns the same in-memory host across HMR re-renders so
 * a successful payment doesn't get reset when React re-runs the host `useMemo`.
 */
export function getDevPaymentHost(): PaymentHost {
  if (cached !== null) return cached;

  const plancksPerCent = BigInt(envConfig.token.plancksPerCent);
  let balancePlancks = BigInt(envConfig.payment.devStartingBalancePlancks);
  let receiptCounter = 0;

  cached = {
    async paymentBalance() {
      return {
        available: safeNumberFromBigInt(balancePlancks / plancksPerCent, "dev balance"),
      };
    },
    async paymentRequest(amountCents) {
      const amountPlancks = BigInt(amountCents) * plancksPerCent;
      if (amountPlancks > balancePlancks) {
        throw new Error(
          `dev reference host: balance ${balancePlancks} plancks below requested ${amountPlancks}`,
        );
      }
      balancePlancks -= amountPlancks;
      receiptCounter += 1;
      return { id: `dev-${receiptCounter}`, settlement: "settled" };
    },
  };
  console.info(
    `[w3spay/dev] standalone reference PaymentHost installed (seed=${envConfig.payment.devStartingBalancePlancks} plancks)`,
  );
  return cached;
}

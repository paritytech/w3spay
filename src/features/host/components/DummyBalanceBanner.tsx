/**
 * Persistent warn-tone banner shown when the host couldn't read the real
 * spendable balance and the payment flow is running on a synthetic one.
 *
 * Reads `balanceDummy` from `usePaymentFlow()` and self-hides when the
 * real balance comes back (e.g. user signs in, host reconnects).
 *
 * Rendered inside `<AppShell>` above `<ScreenTransition>` so it sits
 * over every screen — boot included — without needing per-screen wiring.
 *
 * The banner intentionally doesn't dismiss: the underlying condition
 * (no real balance) persists until the host recovers, and silencing the
 * banner mid-flow would set up the customer for a confusing payment
 * failure at the Pay tap.
 */

import { usePaymentBalanceDerived } from "@/features/host/api/balance.ts";

export function DummyBalanceBanner() {
  const { balanceDummy } = usePaymentBalanceDerived();
  if (!balanceDummy) return null;
  return (
    <div className="dummy-balance-banner" role="status" aria-live="polite">
      <span className="dummy-balance-banner__dot" aria-hidden="true" />
      <span className="dummy-balance-banner__text">
        <strong className="dummy-balance-banner__label">Demo balance.</strong>{" "}
        We couldn't read your real one — sign in &amp; top up in the Polkadot app to pay for real.
      </span>
    </div>
  );
}

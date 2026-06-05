/**
 * Persistent footer affordance for the dev-only manual-payment override.
 * Gated behind `features.devPaymentOverride` (see `src/config.ts`).
 *
 * Mounts at the shell level so the same button sits in the same spot
 * across every screen, and self-suppresses where tapping it would fight
 * the user:
 *   - Feature flag off (prod default): nothing to render.
 *   - Already on a dev-payment route (`/dev-*`): tapping again would yank
 *     the form out from under an in-flight action.
 *   - On a wallet route (`/wallet*`): the tap should belong to the wallet,
 *     not teleport behind it.
 */

import { useLocation } from "@tanstack/react-router";

import { envConfig } from "@/shared/config.ts";
import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";

export function DevPayLauncher() {
  const { pathname } = useLocation();
  const { startDevPay } = usePaymentActions();

  if (!envConfig.features.devPaymentOverride) return null;
  if (pathname.startsWith("/wallet")) return null;
  if (pathname.startsWith("/dev-")) return null;

  return (
    <button
      type="button"
      className="dev-pay-launcher"
      onClick={startDevPay}
      aria-label="Open dev manual-payment form"
      title="Dev · manual pay"
    >
      <span className="dev-pay-launcher__dot" aria-hidden="true" />
      <span className="dev-pay-launcher__label">DEV</span>
    </button>
  );
}

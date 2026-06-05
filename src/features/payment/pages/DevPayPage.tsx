/**
 * Dev-only manual-payment entry. Off by default in prod; opens through
 * the `<DevPayLauncher>` floating button when
 * `features.devPaymentOverride` is on.
 */

import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { DevPayScreen } from "@/features/payment/components/DevPayScreen.tsx";
import { useCoinPaymentHost } from "@/features/host/api/coin-payment-host.ts";
import { usePaymentBalanceDerived } from "@/features/host/api/balance.ts";
import { useFlowStage } from "@/app/router/guards.ts";

export function DevPayPage() {
  const flow = useFlowStage("devPay");
  const actions = usePaymentActions();
  const { host } = useCoinPaymentHost();
  const { availableCents } = usePaymentBalanceDerived();
  if (flow === null) return null;
  return (
    <DevPayScreen
      availableBalanceCents={availableCents}
      onCancel={actions.startScan}
      onPay={(destinationHex, amountCents) => {
        if (host) void actions.performDevPayment(destinationHex, amountCents, host);
      }}
    />
  );
}

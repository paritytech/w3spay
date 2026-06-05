/**
 * Dev-only in-flight manual payment. Pure status surface — the dev-pay
 * mutation in `usePaymentActions.performDevPayment` will navigate to
 * `/dev-done` or `/dev-pay-error` on settle / fail.
 */

import { DevPayingView } from "@/features/payment/components/DevPayScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function DevPayingPage() {
  const flow = useFlowStage("devPaying");
  if (flow === null) return null;
  return <DevPayingView amountCents={flow.amountCents} destinationHex={flow.destinationHex} />;
}

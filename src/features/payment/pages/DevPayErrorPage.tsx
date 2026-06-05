/**
 * Dev-only failed manual payment. Shows the real host reason (not the
 * friendly customer-side copy). Retry loops to a fresh dev-pay entry.
 */

import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { DevPayErrorView } from "@/features/payment/components/DevPayScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function DevPayErrorPage() {
  const flow = useFlowStage("devPayError");
  const actions = usePaymentActions();
  if (flow === null) return null;
  return (
    <DevPayErrorView
      message={flow.message}
      amountCents={flow.amountCents}
      destinationHex={flow.destinationHex}
      onRetry={actions.startDevPay}
      onCancel={actions.startScan}
    />
  );
}

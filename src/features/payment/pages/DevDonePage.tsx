/**
 * Dev-only settled manual payment. Acknowledge goes back to the index;
 * "Another" loops to a fresh dev-pay entry.
 */

import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { DevDoneView } from "@/features/payment/components/DevPayScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function DevDonePage() {
  const flow = useFlowStage("devDone");
  const actions = usePaymentActions();
  if (flow === null) return null;
  return (
    <DevDoneView
      amountCents={flow.amountCents}
      destinationHex={flow.destinationHex}
      paymentId={flow.paymentId}
      onAcknowledge={actions.startScan}
      onAnother={actions.startDevPay}
    />
  );
}

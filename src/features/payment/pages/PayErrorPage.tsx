/**
 * Payment-error page. A `paymentRequest` threw and the categoriser
 * decided it was a payment-side failure (not an auth/host one — those
 * route to the gate). Retry returns to `/confirm` with the same parsed
 * receipt + tip so the previous-attempt context is preserved.
 */

import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { PaymentFailedScreen } from "@/features/payment/components/PaymentFailedScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function PayErrorPage() {
  const flow = useFlowStage("payError");
  const actions = usePaymentActions();
  if (flow === null) return null;
  const { parsed, merchant, tipCents, message } = flow;
  return (
    <PaymentFailedScreen
      message={message}
      amountCents={parsed.amountCents + tipCents}
      onRetry={() => actions.goToStage({ kind: "confirm", parsed, merchant, tipCents })}
      onCancel={actions.startScan}
    />
  );
}

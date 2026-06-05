/**
 * In-flight payment page. Pure status surface — the user can't act here;
 * the send-payment mutation in `usePaymentActions.performPayment` will
 * navigate to `/done` or `/pay-error` on settle / fail.
 */

import { PayingScreen } from "@/features/payment/components/PayingScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function PayingPage() {
  const flow = useFlowStage("paying");
  if (flow === null) return null;
  return (
    <PayingScreen
      amountCents={flow.parsed.amountCents + flow.tipCents}
      merchantDisplayName={flow.merchant.displayName}
    />
  );
}

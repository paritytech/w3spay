/**
 * Already-paid page. Reached when a TSE scan's idempotency key matches a
 * previously settled payment — the host has the money, this prevents a
 * double-spend.
 */

import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { AlreadyPaidScreen } from "@/features/payment/components/AlreadyPaidScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function AlreadyPaidPage() {
  const flow = useFlowStage("alreadyPaid");
  const actions = usePaymentActions();
  if (flow === null) return null;
  return (
    <AlreadyPaidScreen
      parsed={flow.parsed}
      existingPaymentId={flow.existingPaymentId}
      onNewScan={actions.startScan}
    />
  );
}

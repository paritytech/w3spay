// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/** Confirm page — shows receipt totals + merchant, then sends the payment. */

import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { ConfirmScreen } from "@/features/payment/components/ConfirmScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function ConfirmPage() {
  const flow = useFlowStage("confirm");
  const actions = usePaymentActions();
  if (flow === null) return null;
  const { parsed, merchant, tipCents } = flow;
  return (
    <ConfirmScreen
      merchantDisplayName={merchant.displayName}
      merchantId={merchant.merchantId}
      terminalId={merchant.terminalId}
      parsed={parsed}
      tipCents={tipCents}
      destinationDisplay={merchant.destination.value}
      onConfirm={() => void actions.performPayment(parsed, merchant, tipCents)}
      onCancel={actions.startScan}
    />
  );
}

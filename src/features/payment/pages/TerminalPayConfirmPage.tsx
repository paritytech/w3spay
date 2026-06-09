// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Confirm page for the terminal-pay deeplink flow.
 */

import { useFlowStage } from "@/app/router/guards.ts";
import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { TerminalPayConfirmScreen } from "@/features/payment/components/TerminalPayConfirmScreen.tsx";

export function TerminalPayConfirmPage() {
  const flow = useFlowStage("terminalPayConfirm");
  const actions = usePaymentActions();
  if (flow === null) return null;

  const merchantDisplayName = flow.merchant?.displayName ?? flow.qr.terminalId;
  const destinationDisplay = flow.merchant
    ? flow.merchant.destination.value
    : flow.qr.addressSs58;

  return (
    <TerminalPayConfirmScreen
      qr={flow.qr}
      merchantDisplayName={merchantDisplayName}
      terminalId={flow.qr.terminalId}
      destinationDisplay={destinationDisplay}
      onConfirm={() => void actions.performTerminalPayment(flow.qr, flow.merchant)}
      onCancel={actions.startScan}
    />
  );
}

/**
 * Confirm page for the terminal-pay deeplink flow.
 */

import { useFlowStage } from "@/app/router/guards.ts";
import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { useCoinPaymentHost } from "@/features/host/api/coin-payment-host.ts";
import { usePaymentBalanceDerived } from "@/features/host/api/balance.ts";
import { envConfig } from "@/shared/config.ts";
import { TerminalPayConfirmScreen } from "@/features/payment/components/TerminalPayConfirmScreen.tsx";

export function TerminalPayConfirmPage() {
  const flow = useFlowStage("terminalPayConfirm");
  const actions = usePaymentActions();
  const { host } = useCoinPaymentHost();
  const { availableCents } = usePaymentBalanceDerived();
  if (flow === null) return null;

  const merchantDisplayName = flow.merchant?.displayName ?? flow.qr.terminalId;
  const destinationDisplay = flow.merchant
    ? flow.merchant.destination.value
    : flow.qr.addressSs58;
  const insufficient =
    availableCents !== null &&
    availableCents < Math.max(flow.qr.amountCents, envConfig.payment.minSpendableCents);

  return (
    <TerminalPayConfirmScreen
      qr={flow.qr}
      merchantDisplayName={merchantDisplayName}
      terminalId={flow.qr.terminalId}
      destinationDisplay={destinationDisplay}
      availableBalanceCents={availableCents}
      insufficient={insufficient}
      onConfirm={() => {
        if (host) void actions.performTerminalPayment(flow.qr, flow.merchant, host);
      }}
      onCancel={actions.startScan}
    />
  );
}

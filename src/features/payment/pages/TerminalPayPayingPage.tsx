/**
 * In-flight payment interstitial for the terminal-pay deeplink flow.
 */

import { useFlowStage } from "@/app/router/guards.ts";
import { PayingScreen } from "@/features/payment/components/PayingScreen.tsx";

export function TerminalPayPayingPage() {
  const flow = useFlowStage("terminalPayPaying");
  if (flow === null) return null;
  const merchantDisplayName = flow.merchant?.displayName ?? flow.qr.terminalId;
  return (
    <PayingScreen
      amountCents={flow.qr.amountCents}
      merchantDisplayName={merchantDisplayName}
    />
  );
}

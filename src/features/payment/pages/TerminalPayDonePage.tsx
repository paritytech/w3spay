// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Settlement confirmation page for the terminal-pay deeplink flow.
 */

import { useNavigate } from "@tanstack/react-router";

import { PATHS } from "@/app/router/routes.ts";
import { useFlowStage } from "@/app/router/guards.ts";
import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { TerminalPayDoneScreen } from "@/features/payment/components/TerminalPayDoneScreen.tsx";

export function TerminalPayDonePage() {
  const flow = useFlowStage("terminalPayDone");
  const actions = usePaymentActions();
  const navigate = useNavigate();
  if (flow === null) return null;
  const merchantDisplayName = flow.merchant?.displayName ?? flow.qr.terminalId;
  return (
    <TerminalPayDoneScreen
      qr={flow.qr}
      merchantDisplayName={merchantDisplayName}
      settlement={flow.payment.settlement}
      onAcknowledge={actions.startScan}
      onOpenWallet={() => void navigate({ to: PATHS.wallet })}
    />
  );
}

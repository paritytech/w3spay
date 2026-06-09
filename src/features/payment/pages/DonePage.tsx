// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/** Settled-payment page — confirms the transfer, with acknowledge (back to scan) and a wallet shortcut. */

import { useNavigate } from "@tanstack/react-router";

import { PATHS } from "@/app/router/routes.ts";
import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { DoneScreen } from "@/features/payment/components/DoneScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function DonePage() {
  const flow = useFlowStage("done");
  const actions = usePaymentActions();
  const navigate = useNavigate();
  if (flow === null) return null;
  const { parsed, merchant, tipCents, payment } = flow;
  return (
    <DoneScreen
      merchantDisplayName={merchant.displayName}
      terminalId={merchant.terminalId}
      parsed={parsed}
      tipCents={tipCents}
      paymentId={payment.paymentId}
      settlement={payment.settlement}
      onAcknowledge={actions.startScan}
      onOpenWallet={() => void navigate({ to: PATHS.wallet })}
    />
  );
}

// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/** Dev-only manual-payment entry — off by default in prod; opens via `<DevPayLauncher>` when `features.devPaymentOverride` is on. */

import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { DevPayScreen } from "@/features/payment/components/DevPayScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function DevPayPage() {
  const flow = useFlowStage("devPay");
  const actions = usePaymentActions();
  if (flow === null) return null;
  return (
    <DevPayScreen
      onCancel={actions.startScan}
      onPay={(destinationHex, amountCents) =>
        void actions.performDevPayment(destinationHex, amountCents)
      }
    />
  );
}

/**
 * Unsupported-QR page. The scan grace window expired with only a non-TSE
 * payload (legacy deeplink, embedded JSON, …) — surface the human-
 * readable reason and offer a fresh scan.
 */

import { describeUnsupported, truncateRaw } from "@/features/payment/lib/error-messages.ts";
import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { UnsupportedQrScreen } from "@/features/scan/components/UnsupportedQrScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function UnsupportedPage() {
  const flow = useFlowStage("unsupportedScan");
  const actions = usePaymentActions();
  if (flow === null) return null;
  return (
    <UnsupportedQrScreen
      onRetry={actions.startScan}
      description={describeUnsupported(flow.reason)}
      detected={flow.raw.length > 0 ? truncateRaw(flow.raw) : undefined}
    />
  );
}

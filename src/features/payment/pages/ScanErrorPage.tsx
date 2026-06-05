/**
 * Scan-error page. A QR was detected but failed to parse (TSE format
 * mismatch, malformed receipt JSON). Lets the user retry.
 */

import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { ScanFailedScreen } from "@/features/scan/components/ScanFailedScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function ScanErrorPage() {
  const flow = useFlowStage("scanError");
  const actions = usePaymentActions();
  if (flow === null) return null;
  return <ScanFailedScreen onRetry={actions.startScan} errorMessage={flow.message} />;
}

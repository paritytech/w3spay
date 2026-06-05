/**
 * Camera-error page. `getUserMedia` rejected on scanner start
 * (in-use, broken pipe, denied mid-flow). Retry returns to the index.
 */

import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { CameraStartFailedScreen } from "@/features/scan/components/CameraStartFailedScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function CameraErrorPage() {
  const flow = useFlowStage("cameraError");
  const actions = usePaymentActions();
  if (flow === null) return null;
  return <CameraStartFailedScreen onRetry={actions.startScan} errorMessage={flow.message} />;
}

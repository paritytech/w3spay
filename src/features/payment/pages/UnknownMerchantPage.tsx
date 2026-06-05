/**
 * Unknown-merchant page. The TSE was valid but no merchant in the local
 * directory claims the (kassen-serial, merchant-id). Surfaces "not in
 * pilot" and routes back to scan.
 */

import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { NotInPilotScreen } from "@/features/merchants/components/NotInPilotScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function UnknownMerchantPage() {
  const flow = useFlowStage("unknownMerchant");
  const actions = usePaymentActions();
  if (flow === null) return null;
  return <NotInPilotScreen onNewScan={actions.startScan} />;
}

/**
 * Receipt-saved page. Reached when a `t3rminal-receipt` QR is scanned —
 * the local-store save mutation has already run; this is just the
 * confirmation surface with a wallet shortcut.
 */

import { useNavigate } from "@tanstack/react-router";

import { PATHS } from "@/app/router/routes.ts";
import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { ReceiptSavedScreen } from "@/features/payment/components/ReceiptSavedScreen.tsx";
import { useFlowStage } from "@/app/router/guards.ts";

export function ReceiptSavedPage() {
  const flow = useFlowStage("receiptSaved");
  const actions = usePaymentActions();
  const navigate = useNavigate();
  if (flow === null) return null;
  return (
    <ReceiptSavedScreen
      receipt={flow.receipt}
      onOpenWallet={() => void navigate({ to: PATHS.wallet, search: { tab: "receipts" } })}
      onNewScan={actions.startScan}
    />
  );
}

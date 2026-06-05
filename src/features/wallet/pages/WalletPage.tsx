/**
 * Wallet list page — `/wallet?tab=activity|receipts`.
 *
 * Reads the active tab from the URL search param, wires the presentational
 * `<WalletScreen>` to navigation, and lets the user open an individual
 * record by its id (handled by the detail routes).
 */

import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";

import { PATHS } from "@/app/router/routes.ts";
import { walletRoute } from "@/features/wallet/routes.tsx";
import { WalletScreen } from "@/features/wallet/components/WalletScreen.tsx";
import { usePaymentBalanceDerived } from "@/features/host/api/balance.ts";

export function WalletPage() {
  const { tab } = useSearch({ from: walletRoute.id });
  const navigate = useNavigate();
  const router = useRouter();
  const { availableCents } = usePaymentBalanceDerived();
  return (
    <WalletScreen
      activeTab={tab}
      availableBalanceCents={availableCents}
      onChangeTab={(next) =>
        void navigate({ to: PATHS.wallet, search: { tab: next }, replace: true })
      }
      onBack={() => router.history.back()}
      onOpenPaymentRecord={(record) =>
        void navigate({
          to: PATHS.paymentDetail,
          params: { paymentId: record.paymentId },
        })
      }
      onOpenReceiptRecord={(record) =>
        void navigate({
          to: PATHS.receiptDetail,
          params: { saleId: record.receipt.saleId },
        })
      }
    />
  );
}

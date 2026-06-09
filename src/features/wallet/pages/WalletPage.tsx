// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Wallet page — `/wallet`. Lists saved receipts and opens an individual receipt
 * by id (handled by the receipt detail route).
 */

import { useNavigate, useRouter } from "@tanstack/react-router";

import { PATHS } from "@/app/router/routes.ts";
import { WalletScreen } from "@/features/wallet/components/WalletScreen.tsx";

export function WalletPage() {
  const navigate = useNavigate();
  const router = useRouter();
  return (
    <WalletScreen
      onBack={() => router.history.back()}
      onOpenReceiptRecord={(record) =>
        void navigate({
          to: PATHS.receiptDetail,
          params: { saleId: record.receipt.saleId },
        })
      }
    />
  );
}

/**
 * Wallet route table.
 *
 *   - `/wallet?tab=activity|receipts` — list, tab in the search param.
 *   - `/wallet/payment/$paymentId`    — payment record detail (id-addressed).
 *   - `/wallet/receipt/$saleId`       — saved-receipt detail (id-addressed).
 *
 * Detail routes are addressable so a reload / deep-link rehydrates from
 * the local KvStore instead of losing an in-memory selection. The
 * `validateSearch` here is the single source of truth for the wallet
 * tab union — the page reads it via `useSearch({ from: walletRoute.id })`.
 */

import { createRoute } from "@tanstack/react-router";

import { PATHS } from "@/app/router/routes.ts";
import { rootRoute } from "@/app/router/root.tsx";
import { PaymentDetailPage } from "@/features/wallet/pages/PaymentDetailPage.tsx";
import { ReceiptDetailPage } from "@/features/wallet/pages/ReceiptDetailPage.tsx";
import { WalletPage } from "@/features/wallet/pages/WalletPage.tsx";
import type { WalletTab } from "@/features/wallet/components/WalletScreen.tsx";

interface WalletSearch {
  readonly tab: WalletTab;
}

export const walletRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: PATHS.wallet,
  validateSearch: (search: Record<string, unknown>): WalletSearch => ({
    tab: search.tab === "receipts" ? "receipts" : "activity",
  }),
  component: WalletPage,
});

export const paymentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: PATHS.paymentDetail,
  component: PaymentDetailPage,
});

export const receiptDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: PATHS.receiptDetail,
  component: ReceiptDetailPage,
});

export const walletRoutes = [walletRoute, paymentDetailRoute, receiptDetailRoute];

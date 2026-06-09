// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Wallet route table. The detail route is id-addressed so a reload / deep-link
 * rehydrates the receipt from the local KvStore.
 */

import { createRoute } from "@tanstack/react-router";

import { PATHS } from "@/app/router/routes.ts";
import { rootRoute } from "@/app/router/root.tsx";
import { ReceiptDetailPage } from "@/features/wallet/pages/ReceiptDetailPage.tsx";
import { WalletPage } from "@/features/wallet/pages/WalletPage.tsx";

export const walletRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: PATHS.wallet,
  component: WalletPage,
});

export const receiptDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: PATHS.receiptDetail,
  component: ReceiptDetailPage,
});

export const walletRoutes = [walletRoute, receiptDetailRoute];

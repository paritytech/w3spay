// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Payment-feature route table: paths paired with page components. The
 * `requireFlow` `beforeLoad` guard gates data-carrying routes on the session
 * store holding the matching flow payload, so a cold reload or deep-link
 * self-heals back to the index. `scanRoute` is exported separately because
 * TanStack Router wants the index path attached to the root as its first
 * child.
 */

import { createRoute, redirect } from "@tanstack/react-router";

import { PATHS } from "@/app/router/routes.ts";
import { rootRoute } from "@/app/router/root.tsx";
import { requireFlow } from "@/app/router/guards.ts";
import { persistSaveReceiptFromUrl } from "@/features/scan/lib/save-receipt-deeplink.ts";

import { AlreadyPaidPage } from "@/features/payment/pages/AlreadyPaidPage.tsx";
import { CameraErrorPage } from "@/features/payment/pages/CameraErrorPage.tsx";
import { ConfirmPage } from "@/features/payment/pages/ConfirmPage.tsx";
import { DevDonePage } from "@/features/payment/pages/DevDonePage.tsx";
import { DevPayErrorPage } from "@/features/payment/pages/DevPayErrorPage.tsx";
import { DevPayingPage } from "@/features/payment/pages/DevPayingPage.tsx";
import { DevPayPage } from "@/features/payment/pages/DevPayPage.tsx";
import { DonePage } from "@/features/payment/pages/DonePage.tsx";
import { PayErrorPage } from "@/features/payment/pages/PayErrorPage.tsx";
import { PayingPage } from "@/features/payment/pages/PayingPage.tsx";
import { ReceiptSavedPage } from "@/features/payment/pages/ReceiptSavedPage.tsx";
import { ScanErrorPage } from "@/features/payment/pages/ScanErrorPage.tsx";
import { ScanPage } from "@/features/payment/pages/ScanPage.tsx";
import { TipPage } from "@/features/payment/pages/TipPage.tsx";
import { UnknownMerchantPage } from "@/features/payment/pages/UnknownMerchantPage.tsx";
import { UnsupportedPage } from "@/features/payment/pages/UnsupportedPage.tsx";
import { TerminalPayConfirmPage } from "@/features/payment/pages/TerminalPayConfirmPage.tsx";
import { TerminalPayPayingPage } from "@/features/payment/pages/TerminalPayPayingPage.tsx";
import { TerminalPayDonePage } from "@/features/payment/pages/TerminalPayDonePage.tsx";

/** The index `/` — live scan surface (or boot splash while resolving). */
export const scanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: PATHS.scan,
  component: ScanPage,
});

/**
 * `/save-receipt` deep-link landing. The host opens the SPA at
 * `#/save-receipt?…` (cold start) or navigates an already-open SPA there
 * (warm). Cold start is pre-rewritten to `/receipt-saved` by
 * `consumeSaveReceiptDeepLink` before the router boots; this route is the
 * warm-navigation safety net so the link never falls through to Not Found.
 * `beforeLoad` parses + persists the payload, then redirects to the
 * receipt-saved confirmation (or the scan index when there's no valid payload).
 */
export const saveReceiptRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: PATHS.saveReceipt,
  beforeLoad: () => {
    throw redirect(
      persistSaveReceiptFromUrl()
        ? { to: PATHS.receiptSaved, replace: true }
        : { to: PATHS.scan, replace: true },
    );
  },
  component: () => null,
});

/** Customer flow + error / outcome routes. */
export const paymentRoutes = [
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.tip,
    beforeLoad: requireFlow("tip"),
    component: TipPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.confirm,
    beforeLoad: requireFlow("confirm"),
    component: ConfirmPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.paying,
    beforeLoad: requireFlow("paying"),
    component: PayingPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.done,
    beforeLoad: requireFlow("done"),
    component: DonePage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.alreadyPaid,
    beforeLoad: requireFlow("alreadyPaid"),
    component: AlreadyPaidPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.receiptSaved,
    beforeLoad: requireFlow("receiptSaved"),
    component: ReceiptSavedPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.unsupported,
    beforeLoad: requireFlow("unsupportedScan"),
    component: UnsupportedPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.scanError,
    beforeLoad: requireFlow("scanError"),
    component: ScanErrorPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.cameraError,
    beforeLoad: requireFlow("cameraError"),
    component: CameraErrorPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.unknownMerchant,
    beforeLoad: requireFlow("unknownMerchant"),
    component: UnknownMerchantPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.payError,
    beforeLoad: requireFlow("payError"),
    component: PayErrorPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.terminalPayConfirm,
    beforeLoad: requireFlow("terminalPayConfirm"),
    component: TerminalPayConfirmPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.terminalPayPaying,
    beforeLoad: requireFlow("terminalPayPaying"),
    component: TerminalPayPayingPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.terminalPayDone,
    beforeLoad: requireFlow("terminalPayDone"),
    component: TerminalPayDonePage,
  }),
];

/** Dev-only manual-payment override routes. */
export const devPayRoutes = [
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.devPay,
    beforeLoad: requireFlow("devPay"),
    component: DevPayPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.devPaying,
    beforeLoad: requireFlow("devPaying"),
    component: DevPayingPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.devDone,
    beforeLoad: requireFlow("devDone"),
    component: DevDonePage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATHS.devPayError,
    beforeLoad: requireFlow("devPayError"),
    component: DevPayErrorPage,
  }),
];

// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Central path registry — every URL the app routes on, named. `PATHS` is the
 * single edit point for route definitions and `navigate({ to })` callsites.
 * Wallet detail routes carry an id segment as the raw pattern so TanStack
 * Router's `params: { paymentId: … }` shape matches.
 */

export const PATHS = {
  scan: "/",

  tip: "/tip",
  confirm: "/confirm",
  paying: "/paying",
  done: "/done",
  alreadyPaid: "/already-paid",
  receiptSaved: "/receipt-saved",
  saveReceipt: "/save-receipt",

  unsupported: "/unsupported",
  scanError: "/scan-error",
  cameraError: "/camera-error",
  unknownMerchant: "/unknown-merchant",
  payError: "/pay-error",

  devPay: "/dev-pay",
  devPaying: "/dev-paying",
  devDone: "/dev-done",
  devPayError: "/dev-pay-error",

  wallet: "/wallet",
  receiptDetail: "/wallet/receipt/$saleId",

  terminalPayConfirm: "/terminal-pay/confirm",
  terminalPayPaying: "/terminal-pay/paying",
  terminalPayDone: "/terminal-pay/done",
} as const;

export type AppPath = (typeof PATHS)[keyof typeof PATHS];

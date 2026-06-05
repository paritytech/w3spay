/**
 * Central path registry — every URL the app routes on, named.
 *
 * `PATHS` is the one place these live: the route definitions and any
 * imperative `navigate({ to: … })` callsite read from here, so a path
 * change is a single edit. `FLOW_PATH` (in `features/payment/lib/
 * route-from-stage.ts`) maps the payment-flow stage union onto this
 * registry; consumers should still prefer naming a path through
 * `PATHS.<name>` over a bare string literal.
 *
 * Wallet detail routes carry an id segment — listed here as the raw
 * pattern so TanStack Router's `params: { paymentId: … }` shape matches.
 */

export const PATHS = {
  // ── Index ────────────────────────────────────────────────────────
  scan: "/",

  // ── Payment flow ────────────────────────────────────────────────
  tip: "/tip",
  confirm: "/confirm",
  paying: "/paying",
  done: "/done",
  alreadyPaid: "/already-paid",
  receiptSaved: "/receipt-saved",

  // ── Flow errors ─────────────────────────────────────────────────
  unsupported: "/unsupported",
  scanError: "/scan-error",
  cameraError: "/camera-error",
  unknownMerchant: "/unknown-merchant",
  payError: "/pay-error",

  // ── Dev pay ─────────────────────────────────────────────────────
  devPay: "/dev-pay",
  devPaying: "/dev-paying",
  devDone: "/dev-done",
  devPayError: "/dev-pay-error",

  // ── Wallet ──────────────────────────────────────────────────────
  wallet: "/wallet",
  paymentDetail: "/wallet/payment/$paymentId",
  receiptDetail: "/wallet/receipt/$saleId",

  // ── t3rminal pay deeplink flow ───────────────────────────────────
  terminalPayConfirm: "/terminal-pay/confirm",
  terminalPayPaying: "/terminal-pay/paying",
  terminalPayDone: "/terminal-pay/done",
} as const;

export type AppPath = (typeof PATHS)[keyof typeof PATHS];

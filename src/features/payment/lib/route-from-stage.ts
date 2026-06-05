/**
 * Bridge between the (tested, pure) stage-decision functions in
 * `app-stage.ts` and the TanStack Router route table.
 *
 * The decision functions still answer "given this outcome, which screen?"
 * by returning an `AppStage`. This module maps the *data-carrying* stages
 * — the ones a user drives through, as opposed to the host-derived gate
 * stages (`boot` / `needsCamera` / `needsLogin` / `hostUnavailable` /
 * `scanning`) — onto their route paths. The payload travels in the
 * session store (`session-store.ts`); the path travels in the URL. They
 * are always written together by `usePaymentActions`, and each flow route
 * re-checks the payload on entry so a reload / deep-link self-heals back
 * to the scan screen.
 */

import type { AppStage } from "@/features/payment/lib/stage.ts";
import { PATHS } from "@/app/router/routes.ts";

/**
 * The subset of `AppStage` the router addresses as its own route and the
 * session store carries as `flow`. Excludes the gate stages, which the
 * root `HostGate` renders from live host state, and `merchantsLoading`,
 * which the scan flow now resolves inline (no dedicated screen).
 */
export type FlowStage = Extract<
  AppStage,
  {
    kind:
      | "tip"
      | "confirm"
      | "paying"
      | "done"
      | "alreadyPaid"
      | "receiptSaved"
      | "unsupportedScan"
      | "scanError"
      | "cameraError"
      | "unknownMerchant"
      | "payError"
      | "devPay"
      | "devPaying"
      | "devDone"
      | "devPayError"
      | "terminalPayConfirm"
      | "terminalPayPaying"
      | "terminalPayDone";
  }
>;

/** Route path for each flow stage. The scan stage lives at the index `/`. */
export const FLOW_PATH: Record<FlowStage["kind"], string> = {
  tip: PATHS.tip,
  confirm: PATHS.confirm,
  paying: PATHS.paying,
  done: PATHS.done,
  alreadyPaid: PATHS.alreadyPaid,
  receiptSaved: PATHS.receiptSaved,
  unsupportedScan: PATHS.unsupported,
  scanError: PATHS.scanError,
  cameraError: PATHS.cameraError,
  unknownMerchant: PATHS.unknownMerchant,
  payError: PATHS.payError,
  devPay: PATHS.devPay,
  devPaying: PATHS.devPaying,
  devDone: PATHS.devDone,
  devPayError: PATHS.devPayError,
  terminalPayConfirm: PATHS.terminalPayConfirm,
  terminalPayPaying: PATHS.terminalPayPaying,
  terminalPayDone: PATHS.terminalPayDone,
};

/**
 * Type guard: is this stage one the router addresses (and the session
 * store carries)? Gate stages return `false` — the caller routes those to
 * the index and lets `HostGate` render the right screen.
 */
export function isFlowStage(stage: AppStage): stage is FlowStage {
  return stage.kind in FLOW_PATH;
}

/**
 * Route path for a stage, or `null` for a gate / scan stage the router
 * does not address directly.
 */
export function stagePath(stage: AppStage): string | null {
  return isFlowStage(stage) ? FLOW_PATH[stage.kind] : null;
}

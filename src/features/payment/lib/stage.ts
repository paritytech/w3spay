/**
 * Stage-decision functions for the customer flow.
 *
 * Pure, React-free: the `AppStage` union plus the functions that map host
 * state / scan outcomes / payment errors onto the next stage. The router
 * (`src/router/`) and `usePaymentActions` consume these — `app-stage`
 * itself owns no state and no effects, which keeps the routing decisions
 * unit-testable in isolation.
 */

import { messageForPaymentError } from "@/features/payment/lib/error-messages.ts";

import type { HostAuthState } from "@/features/host/api/host-auth.ts";
import type { CameraPermissionState } from "@/shared/api/host";
import type { CoinPaymentHostStatus } from "@/features/host/api/coin-payment-host.ts";
import type { MerchantEntry, MerchantTable } from "@/features/merchants/types.ts";
import { identityKey } from "@/features/merchants/lib/load-merchants.ts";
import type { SendPaymentResult } from "@/features/payment/api/send-payment.ts";
import type { UnsupportedReason } from "@/features/scan/lib/dispatcher.ts";
import type { ParsedTseQr } from "@/features/scan/lib/tse-parser.ts";
import type { ParsedReceipt } from "@/features/scan/lib/receipt-parser.ts";
import type { ParsedTerminalPayQr } from "@/features/scan/lib/terminal-pay-parser.ts";

export type AppStage =
  | { kind: "boot" }
  | { kind: "needsCamera"; message: string }
  | { kind: "scanning" }
  | {
      /**
       * Receipt parsed but the merchant table has not loaded yet. The
       * idempotency lookup completed before this stage was set; both
       * pieces are stashed here so the drain effect can resolve the
       * next stage without re-running the async block.
       */
      kind: "merchantsLoading";
      parsed: ParsedTseQr;
      /** Existing paymentId from the device's idempotency store, or null. */
      existingPaymentId: string | null;
    }
  | {
      kind: "tip";
      parsed: ParsedTseQr;
      merchant: MerchantEntry;
    }
  | {
      kind: "confirm";
      parsed: ParsedTseQr;
      merchant: MerchantEntry;
      /** Tip in cents committed on the tip screen. 0 when the customer skipped. */
      tipCents: number;
    }
  | {
      kind: "paying";
      parsed: ParsedTseQr;
      merchant: MerchantEntry;
      tipCents: number;
    }
  | {
      kind: "done";
      parsed: ParsedTseQr;
      merchant: MerchantEntry;
      tipCents: number;
      payment: SendPaymentResult;
    }
  | {
      kind: "alreadyPaid";
      parsed: ParsedTseQr;
      merchant: MerchantEntry;
      existingPaymentId: string;
    }
  | {
      /**
       * A `t3rminal-receipt` QR was scanned and saved locally. Terminal
       * confirmation screen, independent of the payment flow — the
       * receipt is a record-keeping artifact, not a charge.
       */
      kind: "receiptSaved";
      receipt: ParsedReceipt;
    }
  | { kind: "unsupportedScan"; reason: UnsupportedReason; raw: string }
  | { kind: "scanError"; message: string }
  | { kind: "cameraError"; message: string }
  | {
      kind: "unknownMerchant";
      parsed: ParsedTseQr;
    }
  | { kind: "needsLogin" }
  | { kind: "hostUnavailable"; message: string }
  | {
      kind: "payError";
      message: string;
      parsed: ParsedTseQr;
      merchant: MerchantEntry;
      tipCents: number;
    }
  | { kind: "devPay" }
  | { kind: "devPaying"; amountCents: number; destinationHex: string }
  | {
      kind: "devDone";
      amountCents: number;
      destinationHex: string;
      paymentId: string;
    }
  | {
      kind: "devPayError";
      message: string;
      amountCents: number;
      destinationHex: string;
    }
  | {
      /** t3rminal pay deeplink — pre-payment review. */
      kind: "terminalPayConfirm";
      qr: ParsedTerminalPayQr;
      /** Registry-resolved merchant, or null when terminalId not found. */
      merchant: MerchantEntry | null;
    }
  | {
      /** t3rminal pay deeplink — in-flight interstitial. */
      kind: "terminalPayPaying";
      qr: ParsedTerminalPayQr;
      merchant: MerchantEntry | null;
    }
  | {
      /** t3rminal pay deeplink — settlement confirmation. */
      kind: "terminalPayDone";
      qr: ParsedTerminalPayQr;
      merchant: MerchantEntry | null;
      payment: SendPaymentResult;
    };

/**
 * Copy shown on the `needsCamera` screen. Lifted to a constant so the
 * boot-time camera probe (`computeRoutingStage`) and the in-scanner
 * permission-denied callback render exactly the same body.
 */
export const NEEDS_CAMERA_MESSAGE =
  "W3SPay needs camera access to scan the receipt QR. Allow camera access for the Polkadot app and try again.";

/**
 * Pure function that maps current async-state into the routing stage.
 * No side effects, no React.
 *
 * The boot screen is held until ALL four host conditions are terminal:
 *
 *   auth          — connected (not pending / disconnected / errored)
 *   host bridge   — ready or timeout (poll settled)
 *   camera        — granted or denied (probe resolved)
 *   balance       — ready or error (payment-permission modal closed)
 *
 * Only when every condition is terminal does the function return
 * `scanning` and let the scanner route mount. This gives the customer
 * one uninterrupted run through every host-permission modal before the
 * interactive surface appears.
 *
 * `balanceResolved` is `true` when `PaymentBalanceState.kind` is
 * `"ready"` or `"error"` — i.e. the host's payment-permission modal has
 * been accepted or dismissed, regardless of whether balance was actually
 * read successfully. The balance query is disabled (idle) while the host
 * bridge is still polling, so `balanceResolved=false` also keeps the
 * boot screen during that window.
 */
export function computeRoutingStage(
  auth: HostAuthState,
  camera: CameraPermissionState,
  hostStatus: CoinPaymentHostStatus,
  balanceResolved: boolean,
): AppStage {
  if (auth.kind === "outsideHost") {
    return {
      kind: "hostUnavailable",
      message: "W3sPay lives inside the Polkadot app. Open it there to continue.",
    };
  }
  if (auth.kind === "error") {
    return {
      kind: "hostUnavailable",
      // Surface the handshake-specific reason when we have one — "host did
      // not respond, reload" tells the user what to do, which the static
      // "open through your Polkadot app" copy does not. Fall back to the
      // static copy when the error originated in the subscription path
      // (where the reason is usually a low-level SDK exception the
      // customer can't act on).
      message:
        auth.reason.length > 0
          ? auth.reason
          : "Open W3sPay through your Polkadot app to keep going.",
    };
  }
  if (auth.kind === "pending") return { kind: "boot" };
  if (auth.kind === "disconnected") return { kind: "needsLogin" };
  // auth.kind === "connected"
  // Host bridge never appeared after the resolve poll expired. Without
  // a payment host the Pay button is silently disabled later in the
  // flow; surface the failure up-front so the user knows to restart.
  if (hostStatus === "timeout") {
    return {
      kind: "hostUnavailable",
      message: "Payment bridge isn't responding. Restart W3sPay and try again.",
    };
  }
  // Camera gate: only `denied` needs a dedicated screen. `pending` means
  // the probe hasn't fired yet (camera permission is requested on the scan
  // page, not at boot), and `host-unavailable` means the probe is in
  // flight — both are handled by the scan page itself, which withholds the
  // scanner until `granted`. Gating on `denied` here ensures a returning
  // user with a previously-denied grant lands on `CameraDeniedScreen`
  // immediately rather than reaching the scanner and seeing a broken feed.
  if (camera.kind === "denied") {
    return { kind: "needsCamera", message: NEEDS_CAMERA_MESSAGE };
  }
  // Balance / payment-permission gate. Block on boot until the payment
  // modal has closed. The balance query is idle while the host bridge is
  // still polling, so this also covers the `hostStatus === "pending"` case
  // without a separate branch.
  if (!balanceResolved) return { kind: "boot" };
  return { kind: "scanning" };
}

/**
 * Camera UX: after the customer enters the `scanning` stage, the scanner
 * gets this much wall time to find a TSE receipt before we surface the
 * "different kind of code" fallback. Stray QRs decoded during the
 * window (polkadotapp:// deeplinks, random URLs, stickers) are queued
 * via `LastBadScan` and only flushed once the timer fires without a
 * valid TSE landing.
 */
export const UNSUPPORTED_SCAN_GRACE_MS = 60_000;

/**
 * What the scanner saw most recently that *wasn't* a valid TSE receipt
 * during the active grace window. `null` means the camera never decoded
 * anything at all (dead-zone, dim print, lens out of focus).
 */
export type LastBadScan =
  | { kind: "unsupported"; reason: UnsupportedReason; raw: string }
  | { kind: "invalid"; message: string };

/**
 * Decide which stage to flip to when the grace timer fires. Pure for
 * testability: no React, no refs, no side effects. Mirrors the two
 * immediate-transition branches in `handleDecoded`'s pre-debounce
 * version so the post-grace UX is identical to the original
 * fail-fast UX — only the timing changes.
 */
export function stageOnGraceExpiry(captured: LastBadScan | null): AppStage {
  if (captured == null) {
    return { kind: "unsupportedScan", reason: "empty", raw: "" };
  }
  if (captured.kind === "invalid") {
    return {
      kind: "scanError",
      message: `Could not parse receipt QR: ${captured.message}`,
    };
  }
  return { kind: "unsupportedScan", reason: captured.reason, raw: captured.raw };
}

/**
 * Pure helper for `stage-context.tsx#performPayment` catch. Decides
 * whether a thrown payment is actually an auth/host failure (route to
 * `needsLogin` / `hostUnavailable`) or a genuine payment failure
 * (`payError`). Splitting this out keeps the catch branch deterministic
 * and testable without React.
 */
export function derivePayErrorStage(
  caught: unknown,
  authState: HostAuthState,
  parsed: ParsedTseQr,
  merchant: MerchantEntry,
  tipCents: number,
): AppStage {
  if (authState.kind === "disconnected") {
    return { kind: "needsLogin" };
  }
  if (authState.kind === "outsideHost" || authState.kind === "error") {
    return {
      kind: "hostUnavailable",
      message: "Lost the host connection. Reopen W3sPay and try again.",
    };
  }
  const message = messageForPaymentError(caught);
  return { kind: "payError", message, parsed, merchant, tipCents };
}

/**
 * Queued TSE scan stashed in the `merchantsLoading` stage while the
 * merchant table is still loading. The drain effect feeds this back
 * into `resolveMerchantStageAfterLoad` once the table appears.
 */
export interface QueuedMerchantScan {
  readonly parsed: ParsedTseQr;
  /** Existing paymentId from device idempotency, or null. */
  readonly existingPaymentId: string | null;
}

/**
 * Pure helper that maps a freshly-loaded merchant table against a
 * queued scan into the next routing stage. `null` ⇒ stay in
 * `merchantsLoading` (the table hasn't appeared yet).
 *
 * Inputs:
 *  - `merchants` — current value of `usePaymentFlow().merchants`
 *    (`null` while loading, `MerchantTable` once loaded).
 *  - `queued`    — the receipt parsed before the load completed plus
 *    its idempotency state.
 *  - `pilotId`   — env-configured merchant identifier for the lookup key.
 *  - `tipScreenEnabled` — feature flag; routes to `tip` vs `confirm`.
 */
export function resolveMerchantStageAfterLoad(
  merchants: MerchantTable | null,
  queued: QueuedMerchantScan,
  pilotId: string,
  tipScreenEnabled: boolean,
): AppStage | null {
  if (merchants === null) return null;
  const merchant = merchants[identityKey(pilotId, queued.parsed.kassenSerial)];
  if (!merchant) {
    return { kind: "unknownMerchant", parsed: queued.parsed };
  }
  if (queued.existingPaymentId != null) {
    return {
      kind: "alreadyPaid",
      parsed: queued.parsed,
      merchant,
      existingPaymentId: queued.existingPaymentId,
    };
  }
  return tipScreenEnabled
    ? { kind: "tip", parsed: queued.parsed, merchant }
    : { kind: "confirm", parsed: queued.parsed, merchant, tipCents: 0 };
}

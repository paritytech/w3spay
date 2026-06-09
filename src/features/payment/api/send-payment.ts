// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Coinage-backed customer-side payment. Walks straight to the product-sdk
 * host payment manager — no cents-side adapter layer.
 *
 * Units: the host API (RFC 0017 `paymentRequest`) carries **plancks**; the
 * UI works in **cents**. The cents→plancks multiplication happens here and
 * nowhere else.
 *
 * Settlement: the native Android Host API returns from `requestPayment`
 * before the extrinsic is broadcast, driving settlement in the background
 * (`processing` → `completed`/`failed`); we await that subscription so the
 * returned receipt is post-finalization.
 */

import { createPaymentManager, isDevStandalone, sandboxTransport } from "@/shared/api/host";

import { envConfig } from "@/config";
import { getDevPaymentManager } from "@/features/payment/lib/dev-payment-manager.ts";
import type { PaymentManager, PaymentSubscription } from "@/features/payment/lib/payment-sender.ts";
import {
  resolveDestinationBytes,
  type MerchantDestination,
} from "@/features/merchants/lib/destination.ts";

const PLANCKS_PER_CENT = BigInt(envConfig.token.plancksPerCent);

export interface SendPaymentInput {
  /** Receipt total in cents (parsed from the TSE QR, treated as CASH cents 1:1). */
  amountCents: number;
  /** Merchant destination — either a raw AccountId32 or a revive contract. */
  merchantDestination: MerchantDestination;
  /**
   * Test seam: inject a payment manager. In normal use this stays
   * undefined; production resolves the host SDK manager, dev standalone
   * resolves the in-memory dev manager.
   */
  manager?: PaymentManager;
}

export interface SendPaymentResult {
  /** `PaymentReceipt.id` returned by the host. */
  paymentId: string;
  /** Cents debited from the vault. Mirrors `amountCents` 1:1 for the pilot. */
  paidCents: number;
  /**
   * Settlement state surfaced by the host.
   *  - `"settled"`     — host confirmed a terminal `completed` status.
   *  - `"unconfirmed"` — host accepted the request but the settlement
   *    subscription was interrupted before a terminal status arrived;
   *    money may still have moved. Treat as "submitted, reconcile".
   */
  settlement: "settled" | "unconfirmed";
}

export async function sendPayment(input: SendPaymentInput): Promise<SendPaymentResult> {
  const destinationBytes = resolveDestinationBytes(input.merchantDestination);
  // The TSE QR carries EUR cents; coinage spends CASH cents. We treat
  // them 1:1 for the pilot (no FX wire). Real eurobot integration is
  // post-MVP.
  const plancks = BigInt(input.amountCents) * PLANCKS_PER_CENT;
  const manager = input.manager ?? resolvePaymentManager();
  const receipt = await manager.requestPayment(plancks, destinationBytes);
  const settlement = await awaitPaymentSettled(manager, receipt.id);
  return {
    paymentId: receipt.id,
    paidCents: input.amountCents,
    settlement,
  };
}

function resolvePaymentManager(): PaymentManager {
  if (isDevStandalone()) return getDevPaymentManager();
  return createPaymentManager(sandboxTransport);
}

/**
 * Block until the host reports a terminal payment status.
 *
 *  - `"settled"`     — terminal `completed` observed.
 *  - `"unconfirmed"` — subscription interrupted before a terminal status; the
 *    extrinsic may still settle, so surface it (not a failure) for the UI to
 *    reconcile. Promoting an unknown to a definite failure would mis-classify
 *    settled payments as failed and either lose a history record or
 *    re-charge on retry.
 *
 * Terminal `failed` still rejects — an explicit host verdict the payment did
 * NOT go through.
 */
function awaitPaymentSettled(
  manager: PaymentManager,
  paymentId: string,
): Promise<"settled" | "unconfirmed"> {
  return new Promise<"settled" | "unconfirmed">((resolve, reject) => {
    let settled = false;
    let subscription: PaymentSubscription | null = null;

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      subscription?.unsubscribe();
      callback();
    };

    subscription = manager.subscribePaymentStatus(paymentId, (status) => {
      if (status.type === "processing") return;
      if (status.type === "completed") {
        settle(() => resolve("settled"));
        return;
      }
      settle(() => reject(new Error(`Payment failed: ${status.reason}`)));
    });

    subscription.onInterrupt((payload) => {
      settle(() => {
        let detail: string;
        if (payload instanceof Error && payload.message) detail = payload.message;
        else if (typeof payload === "string") detail = payload;
        else {
          try {
            detail = JSON.stringify(payload) ?? String(payload);
          } catch {
            detail = String(payload);
          }
        }
        console.warn(
          "[w3spay/host] payment status subscription interrupted; treating as unconfirmed",
          detail,
        );
        resolve("unconfirmed");
      });
    });

    if (settled) subscription.unsubscribe();
  });
}

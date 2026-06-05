/**
 * Coinage-backed customer-side payment, routed through w3spay's narrow
 * `PaymentHost` interface.
 *
 * The host owns the vault and runs the on-chain extrinsics; w3spay is
 * just an SDK consumer. `sendPayment` resolves the destination from the
 * merchant entry, hands the host the amount and bytes, and returns the
 * receipt id for the done screen.
 */

import type { PaymentHost } from "@/features/host/lib/payment-host.ts";

import {
  resolveDestinationBytes,
  type MerchantDestination,
} from "@/features/merchants/lib/destination.ts";

export interface SendPaymentInput {
  /** Host-owned payer payment surface. */
  host: PaymentHost;
  /** Receipt total in cents (parsed from the TSE QR, treated as CASH cents 1:1). */
  amountCents: number;
  /** Merchant destination — either a raw AccountId32 or a revive contract. */
  merchantDestination: MerchantDestination;
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
   *
   * Adapters that already deliver post-finalization receipts (dotli/TUA)
   * default to `"settled"`.
   */
  settlement: "settled" | "unconfirmed";
}

export async function sendPayment(input: SendPaymentInput): Promise<SendPaymentResult> {
  const destinationBytes = resolveDestinationBytes(input.merchantDestination);
  // The TSE QR carries EUR cents; coinage spends CASH cents. We treat
  // them 1:1 for the pilot (no FX wire). Real eurobot integration is
  // post-MVP.
  const cents = input.amountCents;
  const receipt = await input.host.paymentRequest(cents, destinationBytes);
  return {
    paymentId: receipt.id,
    paidCents: cents,
    settlement: receipt.settlement ?? "settled",
  };
}

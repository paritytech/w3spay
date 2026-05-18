/**
 * RFC 0006 customer-side payment via `@novasamatech/product-sdk`'s
 * `paymentManager.requestPayment`. This goes straight over the iframe
 * `postMessage` sandbox transport that the host SDK installs on import —
 * no `window.truapi` injection, no host-side bridge script.
 *
 * Wire signature (from `host-api/protocol/v1/payments.js`):
 *   host_payment_request({ amount: u128, destination: Bytes(32) })
 *     → Result<PaymentReceipt { id: string }, PaymentRequestErr>
 *
 * Settlement is asynchronous: `requestPayment` resolves once the user
 * authorises and the host accepts. To watch for `Processing → Completed`,
 * subscribe via `paymentManager.subscribePaymentStatus(id, …)` — not done
 * here for the tomorrow-MVP because the cashier-screen acknowledgement
 * happens by eye, and the host only returns a receipt once it has accepted
 * the user-side authorisation.
 */

import { paymentManager } from "@novasamatech/product-sdk";

import {
  encodeReviveContractDestination,
} from "./encode-destination.ts";

export interface SendPaymentInput {
  /** pUSD amount in smallest-unit (10⁻⁶ pUSD per unit). */
  amountUnits: bigint;
  /** Merchant smart-contract address (`pallet-revive` 0x-prefixed H160). */
  smartContractAddress: string;
}

export interface SendPaymentResult {
  /** Host-assigned payment id (RFC 0006 `PaymentId`). */
  paymentId: string;
}

export async function sendPayment(input: SendPaymentInput): Promise<SendPaymentResult> {
  if (input.amountUnits <= 0n) {
    throw new RangeError(`payment amount must be positive, got ${input.amountUnits.toString()}`);
  }
  const destination = encodeReviveContractDestination(input.smartContractAddress);
  const receipt = await paymentManager.requestPayment(input.amountUnits, destination);
  return { paymentId: receipt.id };
}

/**
 * RFC 6 customer-side payment via the host `coinPayment` capability.
 *
 * The whole flow is one awaited call: `paymentRequest(from, amount,
 * destination)` resolves with a `PaymentReceipt { id, reference }` once
 * the host has accepted and processed the payment. We do not subscribe
 * to incremental status — the SDK type contract for `paymentRequest` is
 * "promise to PaymentReceipt", and the resolved receipt is the success
 * signal we hand to the cashier.
 *
 * `from = undefined` → user's MAIN_PURSE (sentinel per RFC 6 §3).
 */

import type {
  CoinPaymentHostApi,
  PaymentReceipt,
} from "@parity/product-sdk-coin-payment";

import {
  encodeReviveContractDestination,
} from "./encode-destination.ts";

/** Maximum pUSD smallest-unit value safely representable as a JS number. */
const MAX_SAFE_BALANCE_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

export interface SendPaymentInput {
  coinPayment: CoinPaymentHostApi;
  /** pUSD amount in smallest-unit (10^-6 pUSD per unit). */
  amountUnits: bigint;
  /** Merchant smart-contract address (`pallet-revive` 0x-prefixed H160). */
  smartContractAddress: string;
}

export interface SendPaymentResult {
  /** The host-assigned payment id (RFC 6 `PaymentId`). */
  paymentId: string;
  /**
   * First on-chain transaction hash from the clearing reference, encoded
   * as `0x`-prefixed lowercase hex. Suitable for cashier-facing display
   * and SubScan deep-linking.
   */
  primaryTransactionHashHex: string;
  /** Raw receipt — surfaced so the UI can render extra fields if needed. */
  receipt: PaymentReceipt;
}

export class PaymentAmountOutOfRangeError extends Error {
  constructor(units: bigint) {
    super(`payment amount ${units.toString()} smallest-units exceeds host-safe range`);
    this.name = "PaymentAmountOutOfRangeError";
  }
}

export async function sendPayment(input: SendPaymentInput): Promise<SendPaymentResult> {
  if (input.amountUnits <= 0n) {
    throw new RangeError(`payment amount must be positive, got ${input.amountUnits.toString()}`);
  }
  if (input.amountUnits > MAX_SAFE_BALANCE_UNITS) {
    throw new PaymentAmountOutOfRangeError(input.amountUnits);
  }
  const destination = encodeReviveContractDestination(input.smartContractAddress);
  const receipt = await input.coinPayment.paymentRequest(
    undefined,
    Number(input.amountUnits),
    destination,
  );
  return {
    paymentId: receipt.id,
    primaryTransactionHashHex: extractPrimaryTransactionHashHex(receipt),
    receipt,
  };
}

function extractPrimaryTransactionHashHex(receipt: PaymentReceipt): string {
  const leaves = receipt.reference?.leaves;
  if (!leaves || leaves.length === 0) {
    return "";
  }
  const [, hashBytes] = leaves[0];
  return bytesToHex0x(hashBytes);
}

function bytesToHex0x(bytes: Uint8Array): string {
  let out = "0x";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

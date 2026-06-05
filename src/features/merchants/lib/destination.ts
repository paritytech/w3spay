/**
 * Merchant destination encoding for the Coinage on-chain transfer.
 *
 * The merchant's "pay-to" identity is encoded as one of two shapes:
 *
 *   - `accountId32` — raw 32-byte AccountId32, hex-encoded. Historical
 *     shape; still used by cached snapshots and tests.
 *   - `reviveContract` — 20-byte H160 from the on-chain registry. Resolved
 *     to AccountId32 by left-padding with 12 zero bytes (see
 *     `../pay/encode-destination.ts`).
 *
 * `resolveDestinationBytes` normalises both into the 32-byte recipient
 * the Coinage `transfer` extrinsic expects.
 */

import {
  encodeReviveContractDestination,
  InvalidContractAddressError,
} from "@/features/merchants/lib/encode-destination.ts";
import { accountIdToHex, parseHexAccountId } from "@/features/merchants/lib/accountid.ts";

export type MerchantDestination =
  | { kind: "accountId32"; value: string }
  | { kind: "reviveContract"; value: string };

export { InvalidContractAddressError };

/**
 * Resolve a discriminated `MerchantDestination` to the 32-byte AccountId32
 * the Coinage `transfer` extrinsic expects.
 *
 * Throws `InvalidContractAddressError` for malformed `reviveContract`
 * inputs, and a plain `Error` for malformed `accountId32` (delegating to
 * `parseHexAccountId`).
 */
export function resolveDestinationBytes(
  destination: MerchantDestination,
): Uint8Array {
  switch (destination.kind) {
    case "accountId32":
      return parseHexAccountId(destination.value);
    case "reviveContract":
      return encodeReviveContractDestination(destination.value);
  }
}

/**
 * Resolve a `MerchantDestination` to a stable 32-byte AccountId32 hex
 * string (`0x` + 64 lowercase hex chars). Used by the payment-history
 * recorder so the on-disk `destination` field is uniform regardless of
 * whether the original directory entry was an `accountId32` or a
 * `reviveContract` H160 — what matters for the history is where the
 * money actually went.
 */
export function resolveDestinationHex(destination: MerchantDestination): string {
  return accountIdToHex(resolveDestinationBytes(destination));
}

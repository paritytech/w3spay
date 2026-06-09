// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Merchant destination encoding for the Coinage on-chain transfer. Two shapes:
 *   - `accountId32` — raw 32-byte AccountId32 hex (cached snapshots, tests).
 *   - `reviveContract` — 20-byte H160 from the registry, resolved to
 *     AccountId32 by left-padding 12 zero bytes (see `encode-destination.ts`).
 * `resolveDestinationBytes` normalises both into the 32-byte recipient.
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
 * Resolve a `MerchantDestination` to the 32-byte AccountId32 the Coinage
 * `transfer` extrinsic expects. Throws `InvalidContractAddressError` for a
 * malformed `reviveContract`, a plain `Error` for a malformed `accountId32`.
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
 * Resolve a `MerchantDestination` to a stable 32-byte AccountId32 hex string —
 * uniform whether the entry was an `accountId32` or a `reviveContract` H160.
 */
export function resolveDestinationHex(destination: MerchantDestination): string {
  return accountIdToHex(resolveDestinationBytes(destination));
}

/**
 * H160 address helpers — the subset of `apps/w3spay-admin/src/util/address.ts`
 * w3spay needs at the contract-call boundary.
 *
 * Admin's full module also derives H160 from a 32-byte Substrate public
 * key (keccak / EVM-mapped sentinel split) and normalises SS58 ↔ H160 ↔
 * AccountId32 for the registry write inputs. w3spay reads only — H160
 * shape validation is all it needs when passing addresses into the
 * `@/sdk/contracts` helpers, and the derivation helpers are
 * skipped to avoid pulling `@noble/hashes` +
 * `@polkadot-api/substrate-bindings` as new dependencies.
 */

import { isHexString } from "ethers";

/** Branded type for a 0x-prefixed 20-byte H160. */
export type H160Hex = `0x${string}`;

/** Branded type for a 0x-prefixed 32-byte AccountId32 (substrate native). */
export type AccountId32Hex = `0x${string}`;

export class InvalidAdminAddressError extends Error {
  constructor(value: string) {
    super(`address must be a 0x-prefixed H160; got ${value}`);
    this.name = "InvalidAdminAddressError";
  }
}

export function isH160Address(value: string): boolean {
  return isHexString(value, 20);
}

export function normalizeH160Address(value: string): H160Hex {
  if (!isH160Address(value)) throw new InvalidAdminAddressError(value);
  return value.toLowerCase() as H160Hex;
}

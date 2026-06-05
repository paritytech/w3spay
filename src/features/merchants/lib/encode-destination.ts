/**
 * Encode a 20-byte H160 destination (0x-prefixed) into the 32-byte
 * `AccountId32` form that the mobile Host API payment path accepts as a
 * transfer recipient.
 *
 * The Android payment host decodes `paymentRequest.destination` directly as
 * a 32-byte `AccountId` and submits a regular asset transfer to it. Passing
 * the H160 as-is is impossible (wrong length), and the old `0xEE × 12 ‖ H160`
 * pallet-revive default mapping produces a different AccountId that the
 * native transfer path cannot settle to. For RFC-0006 payer payments, H160
 * registry rows are represented as the standard left-padded AccountId32:
 *
 *   `0x00 × 12 ‖ H160`
 *
 * The conversion uses ethers' `zeroPadValue` (the same left-padding Solidity
 * applies to `uint128`-style values) and `getBytes`. We keep ethers as the
 * source of truth here because there is no Polkadot SDK equivalent —
 * substrate's standard H160 → AccountId32 mappings are `0xEE × 12 ‖ H160`
 * (pallet-revive default) or `blake2_256("evm:" ‖ H160)` (Frontier), neither
 * of which is what the native payment path expects.
 */

import { getBytes, isHexString, zeroPadValue } from "ethers";

const H160_BYTE_LENGTH = 20;
const ACCOUNT_ID_32_BYTE_LENGTH = 32;

export function encodeReviveContractDestination(
  smartContractAddress: string,
): Uint8Array {
  if (!isHexString(smartContractAddress, H160_BYTE_LENGTH)) {
    throw new InvalidContractAddressError(
      `revive contract address must be a 0x-prefixed ${H160_BYTE_LENGTH}-byte hex string, got "${smartContractAddress}"`,
    );
  }
  return getBytes(zeroPadValue(smartContractAddress, ACCOUNT_ID_32_BYTE_LENGTH));
}

export class InvalidContractAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidContractAddressError";
  }
}

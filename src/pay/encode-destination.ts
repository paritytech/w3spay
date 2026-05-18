/**
 * Encode a `pallet-revive` smart-contract address (20-byte H160, 0x-prefixed)
 * into the 32-byte `AccountId32` form that the RFC 6
 * `host_payment_request` capability accepts as its `destination` field.
 *
 * The active host's RFC 6 implementation passes the destination bytes
 * straight through to the underlying chain `Coinage::transfer`. On Paseo
 * Asset Hub the recipient is a `pallet-revive` contract whose chain account
 * is its **stable mapped AccountId32**.
 *
 * For an unmapped H160 (no `Revive.map_account` ever called for this
 * address), `pallet-revive`'s default `AddressMapper` exposes the contract
 * at the AccountId32 = `0xEE` × 12 ‖ H160. This is the same convention
 * `pallet-evm`'s `HashedAddressMapper` uses with the `0xee` prefix; it is
 * the *default* AccountId32 representation of any EVM-style address before
 * a substrate keypair is bound to it via `map_account`.
 *
 * Contract accounts in revive are never mapped via `map_account` (only EOAs
 * are), so a contract's AccountId32 is always the `0xEE × 12 || H160`
 * canonical form. That is the encoding we lock in for the tomorrow-MVP
 * Web3 Summit demo (§6.1.2 of the W3SPay plan).
 *
 * If a merchant entry instead carries an SS58 fallback EOA address, see
 * {@link encodeSs58Destination} below — it decodes the SS58 directly.
 *
 * SPIKE (planned, §6.1.2): round-trip a test payment to a known revive
 * contract from `t3rminal/lib/contracts/config.ts` against a sandbox host
 * to confirm this encoding before the demo.
 */
const REVIVE_ACCOUNT_PREFIX: Uint8Array = new Uint8Array([
  0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee,
]);

const H160_LENGTH = 20;
const ACCOUNT_ID_32_LENGTH = 32;

export function encodeReviveContractDestination(
  smartContractAddress: string,
): Uint8Array {
  const cleaned = stripHexPrefix(smartContractAddress);
  if (cleaned.length !== H160_LENGTH * 2) {
    throw new InvalidContractAddressError(
      `revive contract address must be 20 bytes (40 hex chars), got ${cleaned.length / 2} bytes for "${smartContractAddress}"`,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new InvalidContractAddressError(
      `revive contract address contains non-hex characters: "${smartContractAddress}"`,
    );
  }
  const out = new Uint8Array(ACCOUNT_ID_32_LENGTH);
  out.set(REVIVE_ACCOUNT_PREFIX, 0);
  for (let i = 0; i < H160_LENGTH; i += 1) {
    out[REVIVE_ACCOUNT_PREFIX.length + i] = parseHexByte(cleaned, i * 2);
  }
  return out;
}

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
}

function parseHexByte(hex: string, index: number): number {
  return (hexNibble(hex.charCodeAt(index)) << 4) | hexNibble(hex.charCodeAt(index + 1));
}

function hexNibble(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  throw new InvalidContractAddressError(`bad hex character code ${code}`);
}

export class InvalidContractAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidContractAddressError";
  }
}

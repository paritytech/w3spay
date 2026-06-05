/**
 * Plain AccountId32 hex helpers. Pulled out of the old coinage-wasm-based
 * vault module so destination resolution can stay WASM-free: dotli owns
 * the vault now, w3spay only needs to parse the 32-byte hex AccountId
 * surfaced by `MerchantDestination.accountId32` entries.
 */

/** 32-byte AccountId → `0x`-prefixed lowercase hex. */
export function accountIdToHex(account: Uint8Array): string {
  let out = "0x";
  for (const byte of account) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/** Parse a `0x`-prefixed 32-byte hex AccountId. */
export function parseHexAccountId(hex: string): Uint8Array {
  const cleaned = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (cleaned.length !== 64) {
    throw new Error(`account id must be 32 bytes (64 hex chars), got ${cleaned.length}`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    const byte = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`invalid hex in account id at byte ${i}`);
    }
    out[i] = byte;
  }
  return out;
}

import { describe, expect, it } from "vitest";

import {
  InvalidContractAddressError,
  resolveDestinationBytes,
  type MerchantDestination,
} from "@/features/merchants/lib/destination.ts";

describe("resolveDestinationBytes — accountId32", () => {
  it("round-trips a zero AccountId32", () => {
    const dest: MerchantDestination = {
      kind: "accountId32",
      value: "0x" + "00".repeat(32),
    };
    const bytes = resolveDestinationBytes(dest);
    expect(bytes).toHaveLength(32);
    expect(bytes.every((b) => b === 0)).toBe(true);
  });

  it("decodes a realistic AccountId32", () => {
    const dest: MerchantDestination = {
      kind: "accountId32",
      value: "0x" + "11".repeat(31) + "22",
    };
    const bytes = resolveDestinationBytes(dest);
    expect(bytes[0]).toBe(0x11);
    expect(bytes[31]).toBe(0x22);
  });

  it("rejects the wrong length", () => {
    expect(() =>
      resolveDestinationBytes({ kind: "accountId32", value: "0xdeadbeef" }),
    ).toThrow();
  });
});

describe("resolveDestinationBytes — reviveContract", () => {
  it("left-pads H160 addresses to 32-byte AccountId32", () => {
    const dest: MerchantDestination = {
      kind: "reviveContract",
      value: "0x1234567890abcdef1234567890abcdef12345678",
    };
    const bytes = resolveDestinationBytes(dest);

    expect(bytes).toHaveLength(32);
    for (let i = 0; i < 12; i += 1) {
      expect(bytes[i]).toBe(0);
    }
    expect(bytes[12]).toBe(0x12);
    expect(bytes[13]).toBe(0x34);
    expect(bytes[30]).toBe(0x56);
    expect(bytes[31]).toBe(0x78);
  });

  it("accepts uppercase hex", () => {
    const dest: MerchantDestination = {
      kind: "reviveContract",
      value: "0x1234567890ABCDEF1234567890ABCDEF12345678",
    };
    const bytes = resolveDestinationBytes(dest);
    expect(bytes[12]).toBe(0x12);
    expect(bytes[19]).toBe(0xef);
  });

  it("rejects bad H160 length", () => {
    expect(() =>
      resolveDestinationBytes({
        kind: "reviveContract",
        value: "0x" + "ab".repeat(10), // 10 bytes, not 20
      }),
    ).toThrow(InvalidContractAddressError);
  });

  it("rejects non-hex characters", () => {
    expect(() =>
      resolveDestinationBytes({
        kind: "reviveContract",
        value: "0x" + "zz".repeat(20),
      }),
    ).toThrow(InvalidContractAddressError);
  });
});

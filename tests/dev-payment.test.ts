import { describe, expect, it } from "vitest";

import {
  MAX_DEV_PAYMENT_CENTS,
  parseDevAccountIdInput,
  parseDevCashAmountInput,
  sanitizeDevCashInput,
  shortenDevDestination,
} from "@/features/payment/lib/dev-payment.ts";

describe("parseDevAccountIdInput", () => {
  const valid = "0x" + "ab".repeat(32); // 64 hex chars after 0x

  it("accepts a canonical 32-byte lowercase hex", () => {
    expect(parseDevAccountIdInput(valid)).toBe(valid);
  });

  it("lowercases mixed-case input on success", () => {
    const mixed = "0xAB" + "cd".repeat(31);
    expect(parseDevAccountIdInput(mixed)).toBe(mixed.toLowerCase());
  });

  it("accepts 0X prefix", () => {
    const upperPrefix = "0X" + "ab".repeat(32);
    expect(parseDevAccountIdInput(upperPrefix)).toBe("0x" + "ab".repeat(32));
  });

  it("trims surrounding whitespace", () => {
    expect(parseDevAccountIdInput(`   ${valid}\n`)).toBe(valid);
  });

  it("decodes a Polkadot SS58 address to canonical hex", () => {
    // Real Polkadot (network 0) AccountId32.
    const ss58 = "12bq7BGSgSzXTuEKcfVG4WPJ4nWNN3EJ9s1wnt2cSpaLuZJU";
    const expected =
      "0x46cc84a341b9f27214128e31a035e1acdbf36ed14aa9a9b7eba486541d4fda01";
    expect(parseDevAccountIdInput(ss58)).toBe(expected);
  });

  it("ignores SS58 network prefix (decodes the same key on any network)", () => {
    // Same 32-byte public key, encoded with the generic-substrate prefix (42).
    const polkadot = "12bq7BGSgSzXTuEKcfVG4WPJ4nWNN3EJ9s1wnt2cSpaLuZJU";
    const generic = "5DfXxr1Npfj42NDof2SFvMZ9DAWifjgA5NHTdb3FtjYpj7hr";
    expect(parseDevAccountIdInput(generic)).toBe(parseDevAccountIdInput(polkadot));
  });

  it("trims surrounding whitespace on SS58 input", () => {
    const ss58 = "12bq7BGSgSzXTuEKcfVG4WPJ4nWNN3EJ9s1wnt2cSpaLuZJU";
    expect(parseDevAccountIdInput(`  ${ss58}\n`)).toBe(parseDevAccountIdInput(ss58));
  });

  it.each([
    ["empty", ""],
    ["missing prefix", "ab".repeat(32)],
    ["one byte short", "0x" + "ab".repeat(31) + "a"],
    ["one byte long", valid + "ab"],
    ["non-hex char", "0x" + "ab".repeat(31) + "zz"],
    ["only 0x", "0x"],
  ])("rejects malformed input (%s)", (_label, input) => {
    expect(parseDevAccountIdInput(input)).toBeNull();
  });
});

describe("parseDevCashAmountInput", () => {
  it("parses positive integer CASH to cents", () => {
    expect(parseDevCashAmountInput("5")).toBe(500);
    expect(parseDevCashAmountInput("100")).toBe(10_000);
  });

  it("parses two-decimal amounts", () => {
    expect(parseDevCashAmountInput("0.01")).toBe(1);
    expect(parseDevCashAmountInput("1.50")).toBe(150);
    expect(parseDevCashAmountInput("12.34")).toBe(1234);
  });

  it("accepts comma as decimal separator", () => {
    expect(parseDevCashAmountInput("1,50")).toBe(150);
    expect(parseDevCashAmountInput("0,01")).toBe(1);
  });

  it("accepts a leading-dot shortform", () => {
    expect(parseDevCashAmountInput(".5")).toBe(50);
    expect(parseDevCashAmountInput(".01")).toBe(1);
  });

  it("clamps to MAX_DEV_PAYMENT_CENTS", () => {
    expect(parseDevCashAmountInput("99999999")).toBe(MAX_DEV_PAYMENT_CENTS);
  });

  it.each([
    ["empty", ""],
    ["zero", "0"],
    ["zero with decimals", "0.00"],
    ["negative", "-1"],
    ["three fractional digits", "1.234"],
    ["letters", "abc"],
    ["two separators", "1.2.3"],
    ["trailing space mid-token", "1. 50"],
  ])("rejects unparseable input (%s)", (_label, input) => {
    expect(parseDevCashAmountInput(input)).toBeNull();
  });
});

describe("sanitizeDevCashInput", () => {
  it("strips non-digit non-separator characters", () => {
    expect(sanitizeDevCashInput("1a2b3")).toBe("123");
  });

  it("collapses multiple separators to one", () => {
    // Keeps the FIRST separator, drops later ones, caps fraction at 2.
    expect(sanitizeDevCashInput("1.5.5")).toBe("1.55");
    expect(sanitizeDevCashInput("1,5,5")).toBe("1,55");
  });

  it("caps the fractional part at two digits", () => {
    expect(sanitizeDevCashInput("1.234")).toBe("1.23");
    expect(sanitizeDevCashInput("1,234")).toBe("1,23");
  });

  it("preserves the comma the user typed first", () => {
    expect(sanitizeDevCashInput("1,5")).toBe("1,5");
  });

  it("is a no-op on already-clean input", () => {
    expect(sanitizeDevCashInput("12.34")).toBe("12.34");
    expect(sanitizeDevCashInput("")).toBe("");
  });
});

describe("shortenDevDestination", () => {
  it("collapses a full 66-char address", () => {
    const full = "0x" + "ab".repeat(32);
    expect(shortenDevDestination(full)).toBe(`${full.slice(0, 6)}…${full.slice(-4)}`);
  });

  it("returns short inputs verbatim", () => {
    expect(shortenDevDestination("0xabcd")).toBe("0xabcd");
  });
});

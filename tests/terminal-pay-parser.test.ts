import { describe, expect, it } from "vitest";
import {
  parseTerminalPayQr,
  TerminalPayParseError,
} from "@/features/scan/lib/terminal-pay-parser.ts";

/**
 * Alice's well-known sr25519 key on the generic Substrate network (prefix 42).
 * `getSs58AddressInfo` strips the network byte and checksum, yielding the
 * canonical 32-byte public key below. Used across the suite as the stable
 * SS58 fixture because its hex representation is published in every
 * Polkadot SDK test-vector list.
 */
const ALICE_SS58 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const ALICE_HEX = "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";

/** Minimal valid query string. */
const VALID_QS = `address=${ALICE_SS58}&amount=10000&terminalId=term-001`;

describe("parseTerminalPayQr", () => {
  // ── Happy path ───────────────────────────────────────────────────────────

  it("returns correct fields for a minimal valid query string", () => {
    const result = parseTerminalPayQr(VALID_QS);
    expect(result.addressSs58).toBe(ALICE_SS58);
    expect(result.addressHex).toBe(ALICE_HEX);
    expect(result.amountPlanks).toBe(10_000);
    // plancksPerCent is 10_000 for the CASH TOKEN → amountCents = floor(10000 / 10000) = 1
    expect(result.amountCents).toBe(Math.floor(10_000 / 10_000));
    expect(result.terminalId).toBe("term-001");
    expect(result.lockAmount).toBe(false);
  });

  it("addressHex is 66 characters and starts with 0x", () => {
    const result = parseTerminalPayQr(VALID_QS);
    expect(result.addressHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.addressHex.length).toBe(66);
  });

  it("amountCents satisfies floor(amountPlanks / plancksPerCent)", () => {
    // 35_001 planks → floor(35001 / 10000) = 3
    const result = parseTerminalPayQr(
      `address=${ALICE_SS58}&amount=35001&terminalId=t`,
    );
    expect(result.amountCents).toBe(Math.floor(35_001 / 10_000));
  });

  it("lockAmount=true is parsed correctly", () => {
    const result = parseTerminalPayQr(
      `address=${ALICE_SS58}&amount=10000&terminalId=term-001&lockAmount=true`,
    );
    expect(result.lockAmount).toBe(true);
  });

  it("lockAmount defaults to false when param is absent", () => {
    const result = parseTerminalPayQr(VALID_QS);
    expect(result.lockAmount).toBe(false);
  });

  it("accepts a full polkadotapp://pay? URL", () => {
    const url = `polkadotapp://pay?${VALID_QS}`;
    const result = parseTerminalPayQr(url);
    expect(result.addressSs58).toBe(ALICE_SS58);
    expect(result.addressHex).toBe(ALICE_HEX);
    expect(result.amountPlanks).toBe(10_000);
    expect(result.terminalId).toBe("term-001");
    expect(result.lockAmount).toBe(false);
  });

  // ── Error cases ──────────────────────────────────────────────────────────

  it("throws TerminalPayParseError(missingAddress) when address param is absent", () => {
    expect(() =>
      parseTerminalPayQr("amount=10000&terminalId=t"),
    ).toThrow(TerminalPayParseError);
    expect(() =>
      parseTerminalPayQr("amount=10000&terminalId=t"),
    ).toThrow(expect.objectContaining({ code: "missingAddress" }));
  });

  it("throws TerminalPayParseError(invalidAddress) for a garbage SS58", () => {
    expect(() =>
      parseTerminalPayQr("address=notanaddress&amount=10000&terminalId=t"),
    ).toThrow(expect.objectContaining({ code: "invalidAddress" }));
  });

  it("throws TerminalPayParseError(missingAmount) when amount param is absent", () => {
    expect(() =>
      parseTerminalPayQr(`address=${ALICE_SS58}&terminalId=t`),
    ).toThrow(expect.objectContaining({ code: "missingAmount" }));
  });

  it("throws TerminalPayParseError(invalidAmount) for a non-numeric amount", () => {
    expect(() =>
      parseTerminalPayQr(`address=${ALICE_SS58}&amount=abc&terminalId=t`),
    ).toThrow(expect.objectContaining({ code: "invalidAmount" }));
  });

  it("throws TerminalPayParseError(nonPositiveAmount) for amount=0", () => {
    expect(() =>
      parseTerminalPayQr(`address=${ALICE_SS58}&amount=0&terminalId=t`),
    ).toThrow(expect.objectContaining({ code: "nonPositiveAmount" }));
  });

  it("throws TerminalPayParseError(invalidAmount) for a negative amount string", () => {
    // "-1" contains a non-digit character so it fails the integer regex, yielding invalidAmount.
    expect(() =>
      parseTerminalPayQr(`address=${ALICE_SS58}&amount=-1&terminalId=t`),
    ).toThrow(expect.objectContaining({ code: "invalidAmount" }));
  });

  it("throws TerminalPayParseError(missingTerminalId) when terminalId param is absent", () => {
    expect(() =>
      parseTerminalPayQr(`address=${ALICE_SS58}&amount=10000`),
    ).toThrow(expect.objectContaining({ code: "missingTerminalId" }));
  });
});

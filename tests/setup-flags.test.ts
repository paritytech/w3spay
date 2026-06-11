import { describe, expect, it } from "vitest";

import {
  isValidRegistryAddress,
  mnemonicWordCount,
  normalizeDomain,
  parseFlags,
  parsePublishFlag,
} from "../scripts/setup.ts";

describe("parseFlags", () => {
  it("defaults every flag when given no args", () => {
    expect(parseFlags([])).toEqual({ yes: false, dryRun: false });
  });

  it("round-trips every flag", () => {
    expect(
      parseFlags(["--network", "previewnet", "--domain", "shop.dot", "--yes", "--dry-run", "--publish"]),
    ).toEqual({
      network: "previewnet",
      domain: "shop.dot",
      yes: true,
      dryRun: true,
      publish: true,
    });
  });

  it("--env aliases --network and -y aliases --yes", () => {
    const flags = parseFlags(["--env", "paseo", "-y"]);
    expect(flags.network).toBe("paseo");
    expect(flags.yes).toBe(true);
  });

  it("--non-interactive aliases --yes", () => {
    expect(parseFlags(["--non-interactive"]).yes).toBe(true);
  });

  it("treats --publish/--no-publish as a tri-state, undefined when absent", () => {
    expect(parseFlags(["--publish"]).publish).toBe(true);
    expect(parseFlags(["--no-publish"]).publish).toBe(false);
    expect(parseFlags([]).publish).toBeUndefined();
  });
});

describe("normalizeDomain", () => {
  it("appends .dot when missing and is idempotent", () => {
    expect(normalizeDomain("shop")).toBe("shop.dot");
    expect(normalizeDomain("shop.dot")).toBe("shop.dot");
  });
});

describe("isValidRegistryAddress", () => {
  it("accepts a 0x + 40-hex address and rejects malformed input", () => {
    expect(isValidRegistryAddress(`0x${"a".repeat(40)}`)).toBe(true);
    expect(isValidRegistryAddress(`0xABCdef${"0".repeat(34)}`)).toBe(true);
    expect(isValidRegistryAddress("0x123")).toBe(false);
    expect(isValidRegistryAddress("nope")).toBe(false);
    expect(isValidRegistryAddress(undefined)).toBe(false);
  });
});

describe("mnemonicWordCount", () => {
  it("counts whitespace-collapsed words", () => {
    expect(mnemonicWordCount("  one   two\tthree ")).toBe(3);
    expect(mnemonicWordCount("")).toBe(0);
  });
});

describe("parsePublishFlag", () => {
  it("treats true/1/yes (any case) as true and everything else as false", () => {
    for (const v of ["true", "TRUE", "1", "yes", "Yes"]) expect(parsePublishFlag(v)).toBe(true);
    for (const v of ["false", "0", "no", "", undefined, "  "]) expect(parsePublishFlag(v)).toBe(false);
  });
});

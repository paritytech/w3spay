import { describe, expect, it } from "vitest";

import { formatAmountCents } from "@/shared/utils/format-amount.ts";

describe("formatAmountCents", () => {
  it("renders zero with two decimals", () => {
    expect(formatAmountCents(0)).toBe("0.00");
  });

  it("zero-pads sub-euro amounts", () => {
    expect(formatAmountCents(99)).toBe("0.99");
    expect(formatAmountCents(1)).toBe("0.01");
    expect(formatAmountCents(10)).toBe("0.10");
  });

  it("renders the cent boundary as 1.00", () => {
    expect(formatAmountCents(100)).toBe("1.00");
  });

  it("renders large values without grouping", () => {
    expect(formatAmountCents(10_000)).toBe("100.00");
    expect(formatAmountCents(1_234_567)).toBe("12345.67");
  });

  it("preserves a minus sign for negative cents", () => {
    expect(formatAmountCents(-1)).toBe("-0.01");
    expect(formatAmountCents(-1_234)).toBe("-12.34");
  });

  it("rejects non-integer input", () => {
    expect(() => formatAmountCents(1.5)).toThrow(TypeError);
    expect(() => formatAmountCents(Number.NaN)).toThrow(TypeError);
    expect(() => formatAmountCents(Infinity)).toThrow(TypeError);
  });
});

import { describe, expect, it } from "vitest";

import {
  computeTipCents,
  DEFAULT_TIP_PERCENT,
  MAX_CUSTOM_TIP_CENTS,
  parseCustomTipInput,
  sanitizeCustomTipInput,
  TIP_PRESETS,
  tipPercentLabel,
} from "@/features/payment/lib/tip.ts";

describe("TIP_PRESETS", () => {
  it("matches the four credit-card-terminal options in display order", () => {
    expect([...TIP_PRESETS]).toEqual([7, 10, 15, 0]);
  });

  it("includes 0% so the customer can deliberately skip", () => {
    expect(TIP_PRESETS).toContain(0);
  });

  it("uses 10% as the default preset", () => {
    expect(TIP_PRESETS).toContain(DEFAULT_TIP_PERCENT);
    expect(DEFAULT_TIP_PERCENT).toBe(10);
  });
});

describe("computeTipCents — presets", () => {
  it("returns 0 for the 0% preset regardless of subtotal", () => {
    expect(computeTipCents(900, { kind: "preset", percent: 0 })).toBe(0);
    expect(computeTipCents(12_345, { kind: "preset", percent: 0 })).toBe(0);
  });

  it("computes 10% of a round subtotal exactly", () => {
    // 10% of €9.00 == €0.90 == 90 cents.
    expect(computeTipCents(900, { kind: "preset", percent: 10 })).toBe(90);
  });

  it("computes 15% of a round subtotal exactly", () => {
    // 15% of €9.00 == €1.35 == 135 cents.
    expect(computeTipCents(900, { kind: "preset", percent: 15 })).toBe(135);
  });

  it("rounds half-up on a fractional result", () => {
    // 15% of €2.55 == 0.3825 EUR == 38.25 cents → 38.
    expect(computeTipCents(255, { kind: "preset", percent: 15 })).toBe(38);
    // 10% of €2.55 == 25.5 cents → round half-up → 26.
    expect(computeTipCents(255, { kind: "preset", percent: 10 })).toBe(26);
  });

  it("handles 20% on a typical Berlin coffee bill", () => {
    // 20% of €4.20 == 84 cents.
    expect(computeTipCents(420, { kind: "preset", percent: 20 })).toBe(84);
  });

  it("treats negative percent as zero (defensive)", () => {
    expect(computeTipCents(900, { kind: "preset", percent: -5 })).toBe(0);
  });
});

describe("computeTipCents — custom", () => {
  it("returns the integer cents directly when in range", () => {
    expect(computeTipCents(900, { kind: "custom", cents: 150 })).toBe(150);
  });

  it("clamps zero and negative custom tips to 0", () => {
    expect(computeTipCents(900, { kind: "custom", cents: 0 })).toBe(0);
    expect(computeTipCents(900, { kind: "custom", cents: -50 })).toBe(0);
  });

  it("clamps to MAX_CUSTOM_TIP_CENTS", () => {
    expect(
      computeTipCents(900, { kind: "custom", cents: MAX_CUSTOM_TIP_CENTS + 1 }),
    ).toBe(MAX_CUSTOM_TIP_CENTS);
    expect(
      computeTipCents(900, { kind: "custom", cents: 10_000_000 }),
    ).toBe(MAX_CUSTOM_TIP_CENTS);
  });

  it("does not depend on subtotal for the custom path", () => {
    expect(computeTipCents(0, { kind: "custom", cents: 200 })).toBe(200);
    expect(computeTipCents(99_999, { kind: "custom", cents: 200 })).toBe(200);
  });
});

describe("computeTipCents — input validation", () => {
  it("rejects non-integer subtotals", () => {
    expect(() => computeTipCents(9.5, { kind: "preset", percent: 10 })).toThrow(
      TypeError,
    );
  });

  it("rejects negative subtotals", () => {
    expect(() => computeTipCents(-1, { kind: "preset", percent: 10 })).toThrow(
      TypeError,
    );
  });

  it("rejects non-finite subtotals", () => {
    expect(() =>
      computeTipCents(Number.NaN, { kind: "preset", percent: 10 }),
    ).toThrow(TypeError);
    expect(() =>
      computeTipCents(Infinity, { kind: "preset", percent: 10 }),
    ).toThrow(TypeError);
  });
});

describe("parseCustomTipInput", () => {
  it("returns null for empty / whitespace input so the screen stays in a pending state", () => {
    expect(parseCustomTipInput("")).toBeNull();
    expect(parseCustomTipInput("   ")).toBeNull();
  });

  it("parses integer euros", () => {
    expect(parseCustomTipInput("3")).toBe(300);
  });

  it("parses two-decimal euros (dot)", () => {
    expect(parseCustomTipInput("1.50")).toBe(150);
    expect(parseCustomTipInput("0.99")).toBe(99);
  });

  it("parses one-decimal euros", () => {
    expect(parseCustomTipInput("1.5")).toBe(150);
  });

  it("accepts the German comma decimal separator", () => {
    expect(parseCustomTipInput("1,50")).toBe(150);
    expect(parseCustomTipInput("0,99")).toBe(99);
  });

  it("accepts a leading decimal (.50)", () => {
    expect(parseCustomTipInput(".5")).toBe(50);
    expect(parseCustomTipInput(".50")).toBe(50);
    expect(parseCustomTipInput(",5")).toBe(50);
  });

  it("rejects more than two fractional digits — receipts settle in cents", () => {
    expect(parseCustomTipInput("1.500")).toBeNull();
    expect(parseCustomTipInput("1,500")).toBeNull();
  });

  it("rejects multiple decimal separators", () => {
    expect(parseCustomTipInput("1.2.3")).toBeNull();
    expect(parseCustomTipInput("1,2,3")).toBeNull();
  });

  it("rejects non-numeric junk", () => {
    expect(parseCustomTipInput("abc")).toBeNull();
    expect(parseCustomTipInput("€2.00")).toBeNull();
  });

  it("rejects negative values", () => {
    expect(parseCustomTipInput("-1")).toBeNull();
  });

  it("clamps very large inputs to MAX_CUSTOM_TIP_CENTS", () => {
    expect(parseCustomTipInput("99999.99")).toBe(MAX_CUSTOM_TIP_CENTS);
    expect(parseCustomTipInput("1000000")).toBe(MAX_CUSTOM_TIP_CENTS);
  });
});

describe("tipPercentLabel", () => {
  it("returns 0 for a zero tip", () => {
    expect(tipPercentLabel(900, 0)).toBe(0);
  });

  it("returns 0 when subtotal is 0", () => {
    expect(tipPercentLabel(0, 50)).toBe(0);
  });

  it("rounds to the nearest whole percent", () => {
    // 90 / 900 == 10%.
    expect(tipPercentLabel(900, 90)).toBe(10);
    // 50 / 900 == 5.55% → 6.
    expect(tipPercentLabel(900, 50)).toBe(6);
    // 26 / 255 == 10.196% → 10.
    expect(tipPercentLabel(255, 26)).toBe(10);
  });

  it("handles custom tips smaller than 0.5% as 0", () => {
    // 1 cent on €10 == 0.1% → 0.
    expect(tipPercentLabel(1000, 1)).toBe(0);
  });
});

describe("sanitizeCustomTipInput", () => {
  it("returns an empty string for fully-junk input", () => {
    expect(sanitizeCustomTipInput("abc")).toBe("");
    expect(sanitizeCustomTipInput("€$%")).toBe("");
  });

  it("preserves clean integer input", () => {
    expect(sanitizeCustomTipInput("5")).toBe("5");
    expect(sanitizeCustomTipInput("123")).toBe("123");
  });

  it("preserves clean decimal input with either separator", () => {
    expect(sanitizeCustomTipInput("1.50")).toBe("1.50");
    expect(sanitizeCustomTipInput("1,50")).toBe("1,50");
  });

  it("caps the fractional part at two digits", () => {
    expect(sanitizeCustomTipInput("1.500")).toBe("1.50");
    expect(sanitizeCustomTipInput("1,500")).toBe("1,50");
  });

  it("preserves whichever separator the customer typed first", () => {
    // German locale: comma stays visible.
    expect(sanitizeCustomTipInput("0,99")).toBe("0,99");
  });

  it("collapses extra separators into the fractional part", () => {
    expect(sanitizeCustomTipInput("1.5.5")).toBe("1.55");
    expect(sanitizeCustomTipInput("1,5,5")).toBe("1,55");
  });

  it("drops alphabetic noise while keeping the digits", () => {
    expect(sanitizeCustomTipInput("€1.50")).toBe("1.50");
    expect(sanitizeCustomTipInput("abc1.50def")).toBe("1.50");
  });

  it("never produces a string the parser would reject for the same numeric intent", () => {
    for (const raw of ["1.500", "1.5.5", "abc1,99x", "€2.10", "0,01", "10"]) {
      const sanitized = sanitizeCustomTipInput(raw);
      // Sanitized output is always either empty or parseable.
      if (sanitized !== "") {
        expect(parseCustomTipInput(sanitized)).not.toBeNull();
      }
    }
  });
});

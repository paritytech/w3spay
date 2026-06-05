import { describe, expect, it } from "vitest";
import {
  parseTseQr,
  TseParseError,
  type VatBreakdown,
} from "@/features/scan/lib/tse-parser.ts";
import { dispatchScannedPayload } from "@/features/scan/lib/dispatcher.ts";
import { accountIdToHex, parseHexAccountId } from "@/features/merchants/lib/accountid.ts";
import { formatAmountCents } from "@/shared/utils/format-amount.ts";

/**
 * APL Germany TSE pamphlet sample payload — the canonical reference that
 * vendor documentation uses to describe the wire format. We test against
 * this verbatim because it is the only externally-anchored fixture that
 * is guaranteed to remain stable across vendor implementations.
 */
const APL_KASSENBELEG_V1_QR =
  "V0;955002-00;Kassenbeleg-V1;Beleg^0.00_2.55_0.00_0.00_0.00^Bar:2.55;1;42;2020-04-30T14:30:00.000Z;2020-04-30T14:30:01.000Z;ecdsa-plain-SHA256;unixTime;BASE64SIG;BASE64KEY";

/**
 * Real-world QR payload captured off a printed German fiscal receipt
 * (different TSE vendor than the APL pamphlet sample). Anchors the parser
 * against a vendor-specific quirk: the payment-split section is
 * `<amount>:Bar` rather than the APL `Bar:<amount>` ordering. The parser
 * ignores that third `^`-section entirely, so this round-trip proves the
 * VAT-totals parser is the only thing that matters for amount derivation.
 *
 * - kassenSerial: 1342061307
 * - total: €9.00, fully in the 19%-VAT bucket
 * - transaction 7128, signature counter 15124
 */
const REAL_VENDOR_KASSENBELEG_V1_QR =
  "V0;1342061307;Kassenbeleg-V1;Beleg^9.00_0.00_0.00_0.00_0.00^9.00:Bar;7128;15124;2026-05-06T12:25:05.000Z;2026-05-06T12:25:31.000Z;ecdsa-plain-SHA256;unixTime;x8XI+5WbIwsUvOTi1l8QzlEScbN9gaHuUafT+ytIcQ2LtiLDu9Jv+zKoKjvioXcSDt3IXNVNsKFfKhvN9OjfFw==;BJlf238fEMG/ycfzOUBpIHa8OZNMXFMZx9ug42Vs6F0zOx42io2pnoWnRvoNelTAY1J4+2ePsszO3CeJrgfLWb8=";

describe("parseTseQr", () => {
  it("parses the APL Germany Kassenbeleg-V1 sample QR", () => {
    const parsed = parseTseQr(APL_KASSENBELEG_V1_QR);
    expect(parsed.kassenSerial).toBe("955002-00");
    expect(parsed.processType).toBe("Kassenbeleg-V1");
    expect(parsed.amountCents).toBe(255);
    expect(parsed.transactionNumber).toBe("1");
    expect(parsed.signatureCounter).toBe("42");
    expect(parsed.signatureBase64).toBe("BASE64SIG");
    expect(parsed.publicKeyBase64).toBe("BASE64KEY");
  });

  it("returns a VAT 7% allocation for the APL Bar:2.55 receipt", () => {
    const parsed = parseTseQr(APL_KASSENBELEG_V1_QR);
    const expectedBreakdown: VatBreakdown = {
      vat19Cents: 0,
      vat7Cents: 255,
      vatExemptCents: 0,
      vat19PartCents: 0,
      vatReducedCents: 0,
    };
    expect(parsed.vatBreakdownCents).toEqual(expectedBreakdown);
  });

  it("sums totals across multiple VAT classes", () => {
    // Coffee at 19%, pretzel at 7%.
    const multiVat =
      "V0;955002-00;Kassenbeleg-V1;Beleg^3.50_2.55_0.00_0.00_0.00^Bar:6.05;7;101;2020-04-30T14:30:00.000Z;2020-04-30T14:30:01.000Z;ecdsa-plain-SHA256;unixTime;X;Y";
    const parsed = parseTseQr(multiVat);
    expect(parsed.amountCents).toBe(605);
    expect(parsed.vatBreakdownCents.vat19Cents).toBe(350);
    expect(parsed.vatBreakdownCents.vat7Cents).toBe(255);
  });

  it("rejects payloads that aren't TSE-prefixed", () => {
    expect(() => parseTseQr("V1;a;b;c;d;e;f;g;h;i;j;k")).toThrow(TseParseError);
  });

  it("rejects payloads with the wrong field count", () => {
    expect(() => parseTseQr("V0;955002-00;Kassenbeleg-V1")).toThrow(TseParseError);
  });

  it("rejects non-Kassenbeleg-V1 process types", () => {
    const malformed = APL_KASSENBELEG_V1_QR.replace("Kassenbeleg-V1", "Bestellung-V1");
    expect(() => parseTseQr(malformed)).toThrow(TseParseError);
  });

  it("rejects malformed processData shapes", () => {
    const malformed =
      "V0;955002-00;Kassenbeleg-V1;Order^1.00_2.00_3.00_4.00_5.00^Bar:1.00;1;42;t1;t2;ecdsa;unix;X;Y";
    expect(() => parseTseQr(malformed)).toThrow(TseParseError);
  });

  it("rejects malformed VAT totals", () => {
    const malformed =
      "V0;955002-00;Kassenbeleg-V1;Beleg^abc_2.55_0.00_0.00_0.00^Bar:2.55;1;42;t1;t2;ecdsa;unix;X;Y";
    expect(() => parseTseQr(malformed)).toThrow(TseParseError);
  });

  it("rejects zero-total receipts", () => {
    const malformed =
      "V0;955002-00;Kassenbeleg-V1;Beleg^0.00_0.00_0.00_0.00_0.00^Bar:0.00;1;42;t1;t2;ecdsa;unix;X;Y";
    expect(() => parseTseQr(malformed)).toThrow(TseParseError);
  });

  it("handles single-decimal amounts (e.g. 1.5 → 150 cents)", () => {
    const oneDecimal =
      "V0;955002-00;Kassenbeleg-V1;Beleg^1.5_0_0_0_0^Bar:1.5;1;42;t1;t2;ecdsa;unix;X;Y";
    const parsed = parseTseQr(oneDecimal);
    expect(parsed.amountCents).toBe(150);
  });

  it("parses a real-world vendor payload (amount-first payment split)", () => {
    const parsed = parseTseQr(REAL_VENDOR_KASSENBELEG_V1_QR);
    expect(parsed.kassenSerial).toBe("1342061307");
    expect(parsed.processType).toBe("Kassenbeleg-V1");
    expect(parsed.amountCents).toBe(900);
    expect(parsed.transactionNumber).toBe("7128");
    expect(parsed.signatureCounter).toBe("15124");
    expect(parsed.startTime).toBe("2026-05-06T12:25:05.000Z");
    expect(parsed.logTime).toBe("2026-05-06T12:25:31.000Z");
    expect(parsed.sigAlgorithm).toBe("ecdsa-plain-SHA256");
    expect(parsed.logTimeFormat).toBe("unixTime");
    // The signature + key are passed through verbatim so a downstream verifier
    // can validate the TSE chain. We don't decode them in this milestone.
    expect(parsed.signatureBase64).toBe(
      "x8XI+5WbIwsUvOTi1l8QzlEScbN9gaHuUafT+ytIcQ2LtiLDu9Jv+zKoKjvioXcSDt3IXNVNsKFfKhvN9OjfFw==",
    );
    expect(parsed.publicKeyBase64).toBe(
      "BJlf238fEMG/ycfzOUBpIHa8OZNMXFMZx9ug42Vs6F0zOx42io2pnoWnRvoNelTAY1J4+2ePsszO3CeJrgfLWb8=",
    );
    // All €9.00 fall into the 19%-VAT bucket; the other classes stay zero.
    expect(parsed.vatBreakdownCents).toEqual({
      vat19Cents: 900,
      vat7Cents: 0,
      vatExemptCents: 0,
      vat19PartCents: 0,
      vatReducedCents: 0,
    });
  });
});

describe("dispatchScannedPayload", () => {
  it("routes a TSE QR to the parser", () => {
    const result = dispatchScannedPayload(APL_KASSENBELEG_V1_QR);
    expect(result.kind).toBe("tse");
    if (result.kind === "tse") {
      expect(result.payload.kassenSerial).toBe("955002-00");
    }
  });

  it("routes the real-world vendor payload to the parser", () => {
    const result = dispatchScannedPayload(REAL_VENDOR_KASSENBELEG_V1_QR);
    expect(result.kind).toBe("tse");
    if (result.kind === "tse") {
      expect(result.payload.kassenSerial).toBe("1342061307");
      expect(result.payload.amountCents).toBe(900);
    }
  });

  it("flags a malformed polkadotapp:// deeplink as invalid (t3rminal-pay parse error)", () => {
    // A polkadotapp://pay URL with an invalid address now routes through
    // the t3rminal-pay parser; bad params surface as `invalid`, not `unsupported`.
    const result = dispatchScannedPayload("polkadotapp://pay?address=not-an-ss58&amount=10&terminalId=t1");
    expect(result.kind).toBe("invalid");
  });

  it("flags polkadot: URIs as unsupported", () => {
    const result = dispatchScannedPayload("polkadot:5GrwvaEF…");
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("polkadotUriScheme");
    }
  });

  it("flags embedded JSON claims as unsupported", () => {
    const result = dispatchScannedPayload('{"version":0,"handoff":{"kind":"standard"}}');
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("embeddedQrJson");
    }
  });

  it("flags empty payloads", () => {
    const result = dispatchScannedPayload("");
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("empty");
    }
  });

  it("returns invalid when prefix matches but parse fails", () => {
    const result = dispatchScannedPayload("V0;a;b;c;d;e;f;g;h;i;j");
    expect(result.kind).toBe("invalid");
  });
});

describe("parseHexAccountId / accountIdToHex", () => {
  it("round-trips a 32-byte zero account", () => {
    const hex = "0x" + "00".repeat(32);
    const bytes = parseHexAccountId(hex);
    expect(bytes).toHaveLength(32);
    expect(accountIdToHex(bytes)).toBe(hex);
  });

  it("decodes a realistic merchant placeholder", () => {
    const hex = "0x" + "00".repeat(31) + "01";
    const bytes = parseHexAccountId(hex);
    expect(bytes[31]).toBe(0x01);
    expect(accountIdToHex(bytes)).toBe(hex);
  });

  it("accepts unprefixed hex", () => {
    const bytes = parseHexAccountId("ee".repeat(32));
    expect(bytes[0]).toBe(0xee);
    expect(bytes[31]).toBe(0xee);
  });

  it("rejects the wrong length", () => {
    expect(() => parseHexAccountId("0xdeadbeef")).toThrow();
  });

  it("rejects non-hex characters", () => {
    expect(() => parseHexAccountId("0x" + "zz".repeat(32))).toThrow();
  });
});

describe("formatAmountCents", () => {
  it("renders cents → display string", () => {
    expect(formatAmountCents(255)).toBe("2.55");
    expect(formatAmountCents(0)).toBe("0.00");
    expect(formatAmountCents(99)).toBe("0.99");
    expect(formatAmountCents(10_000)).toBe("100.00");
  });
});

/**
 * Real-world TSE payload (1-cent VAT-7 cash sale). Locked in so the
 * parser keeps accepting valid low-value receipts; previously a
 * `nonPositiveAmount` regression on `0.00 + 0.01 + 0.00 + 0.00 + 0.00`
 * would have hidden the rounding bug.
 */
describe("real-world TSE payloads", () => {
  it("parses a 1-cent VAT-7 cash sale", () => {
    const raw =
      "V0;955002-00;Kassenbeleg-V1;Beleg^0.00_0.01_0.00_0.00_0.00^Bar:0.01;9001;9001;2026-05-21T10:00:00.000Z;2026-05-21T10:00:01.000Z;ecdsa-plain-SHA256;unixTime;BASE64SIG;BASE64KEY";
    const parsed = parseTseQr(raw);
    expect(parsed.amountCents).toBe(1);
    expect(parsed.vatBreakdownCents.vat7Cents).toBe(1);
    expect(parsed.kassenSerial).toBe("955002-00");
    expect(parsed.transactionNumber).toBe("9001");
    expect(parsed.signatureCounter).toBe("9001");
  });
});

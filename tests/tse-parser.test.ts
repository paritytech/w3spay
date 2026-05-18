import { describe, expect, it } from "vitest";
import {
  parseTseQr,
  TseParseError,
  type VatBreakdown,
} from "../src/scan/tse-parser.ts";
import { dispatchScannedPayload } from "../src/scan/dispatcher.ts";
import {
  encodeReviveContractDestination,
  InvalidContractAddressError,
} from "../src/pay/encode-destination.ts";
import {
  eurCentsToPusdUnits,
  formatEurCents,
  formatPusdSmallestUnit,
} from "../src/fx/eur-to-pusd.ts";

/**
 * APL Germany TSE pamphlet sample payload — the canonical reference that
 * vendor documentation uses to describe the wire format. We test against
 * this verbatim because it is the only externally-anchored fixture that
 * is guaranteed to remain stable across vendor implementations.
 */
const APL_KASSENBELEG_V1_QR =
  "V0;955002-00;Kassenbeleg-V1;Beleg^0.00_2.55_0.00_0.00_0.00^Bar:2.55;1;42;2020-04-30T14:30:00.000Z;2020-04-30T14:30:01.000Z;ecdsa-plain-SHA256;unixTime;BASE64SIG;BASE64KEY";

describe("parseTseQr", () => {
  it("parses the APL Germany Kassenbeleg-V1 sample QR", () => {
    const parsed = parseTseQr(APL_KASSENBELEG_V1_QR);
    expect(parsed.kassenSerial).toBe("955002-00");
    expect(parsed.processType).toBe("Kassenbeleg-V1");
    expect(parsed.amountEurCents).toBe(255);
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
    expect(parsed.vatBreakdownEurCents).toEqual(expectedBreakdown);
  });

  it("sums totals across multiple VAT classes", () => {
    // Coffee at 19%, pretzel at 7%.
    const multiVat =
      "V0;955002-00;Kassenbeleg-V1;Beleg^3.50_2.55_0.00_0.00_0.00^Bar:6.05;7;101;2020-04-30T14:30:00.000Z;2020-04-30T14:30:01.000Z;ecdsa-plain-SHA256;unixTime;X;Y";
    const parsed = parseTseQr(multiVat);
    expect(parsed.amountEurCents).toBe(605);
    expect(parsed.vatBreakdownEurCents.vat19Cents).toBe(350);
    expect(parsed.vatBreakdownEurCents.vat7Cents).toBe(255);
  });

  it("rejects payloads that aren't TSE-prefixed", () => {
    expect(() => parseTseQr("V1;a;b;c;d;e;f;g;h;i;j;k")).toThrow(TseParseError);
  });

  it("rejects payloads with the wrong field count", () => {
    expect(() => parseTseQr("V0;955002-00;Kassenbeleg-V1")).toThrow(TseParseError);
  });

  it("rejects non-Kassenbeleg-V1 process types", () => {
    const malformed = APL_KASSENBELEG_V1_QR.replace(
      "Kassenbeleg-V1",
      "Bestellung-V1",
    );
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
    expect(parsed.amountEurCents).toBe(150);
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

  it("flags a polkadotapp:// deeplink as unsupported with a stable reason", () => {
    const result = dispatchScannedPayload("polkadotapp://pay?address=5Foo&amount=10");
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("legacyPolkadotappDeeplink");
    }
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

describe("encodeReviveContractDestination", () => {
  it("pads 20-byte H160 with 12 0xee bytes for the default AccountId32 mapping", () => {
    const out = encodeReviveContractDestination("0xA2E388421467E0193570Af45Bd03F0F379c47E88");
    expect(out).toHaveLength(32);
    expect(Array.from(out.slice(0, 12))).toEqual(Array(12).fill(0xee));
    expect(Array.from(out.slice(12))).toEqual([
      0xa2, 0xe3, 0x88, 0x42, 0x14, 0x67, 0xe0, 0x19, 0x35, 0x70,
      0xaf, 0x45, 0xbd, 0x03, 0xf0, 0xf3, 0x79, 0xc4, 0x7e, 0x88,
    ]);
  });

  it("accepts non-prefixed hex", () => {
    const out = encodeReviveContractDestination("A2E388421467E0193570Af45Bd03F0F379c47E88");
    expect(out[12]).toBe(0xa2);
    expect(out[31]).toBe(0x88);
  });

  it("rejects addresses of the wrong length", () => {
    expect(() => encodeReviveContractDestination("0xdeadbeef")).toThrow(InvalidContractAddressError);
  });

  it("rejects non-hex characters", () => {
    expect(() => encodeReviveContractDestination("0xZZ".padEnd(42, "0"))).toThrow(InvalidContractAddressError);
  });
});

describe("fx eur → pusd", () => {
  it("converts 2.55 EUR @ 1.07 to 2729850 pUSD smallest-units", () => {
    // 255 cents * 1.07 = 272.85 cents-equivalent, in pUSD smallest-unit (10^-6) → 2,728,500 units.
    // Actually: 255 cents * 1.07 * 10000 = 2,728,500 units. Half-away-from-zero on integer math.
    const units = eurCentsToPusdUnits(255, 1.07);
    expect(units).toBe(2_728_500n);
  });

  it("renders cents → display string", () => {
    expect(formatEurCents(255)).toBe("2.55");
    expect(formatEurCents(0)).toBe("0.00");
    expect(formatEurCents(99)).toBe("0.99");
  });

  it("renders pUSD smallest-unit → display string", () => {
    expect(formatPusdSmallestUnit(2_728_500n)).toBe("2.72");
    expect(formatPusdSmallestUnit(1_000_000n)).toBe("1.00");
    expect(formatPusdSmallestUnit(123n)).toBe("0.00");
  });
});

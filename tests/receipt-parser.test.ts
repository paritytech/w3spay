import { describe, expect, it } from "vitest";

import {
  parseDecimalToCents,
  parseReceipt,
  parseReceiptQr,
  ReceiptParseError,
  RECEIPT_QR_TYPE,
  RECEIPT_QR_VERSION,
} from "@/features/scan/lib/receipt-parser.ts";
import { dispatchScannedPayload } from "@/features/scan/lib/dispatcher.ts";
import {
  itemLineTotalCents,
  receiptTaxCents,
  readReceipts,
  RECEIPTS_KEY,
  saveReceipt,
  type ReceiptRecord,
} from "@/features/wallet/api/receipts.ts";
import type { KvStore } from "@/shared/utils/kv-store.ts";
import { envConfig } from "@/config";

/**
 * The canonical sample payload from the plan — the exact `t3rminal-receipt`
 * wire shape W3sPay consumes. Defined as an object and stringified at the
 * call site so the dispatcher tests exercise the real JSON path.
 */
const SAMPLE_RECEIPT = {
  v: 1,
  type: "t3rminal-receipt",
  saleId: "01KSPY4NC1RD5FEA039Y5GQ8JR",
  amount: "7.50",
  asset: "CASH TOKEN",
  currency: "CASH TOKEN",
  taxRate: 19,
  business: {
    name: "Funkhaus Berlin Events GmbH",
    addressLine1: "Nalepastraße 18",
    addressLine2: "12459 Berlin",
    phone: "030/12085416",
  },
  items: [
    { name: "Cappuccino", quantity: 1, unitPrice: "3.00" },
    { name: "Currywurst", quantity: 1, unitPrice: "4.50" },
  ],
  issuedAt: "2026-06-02T09:14:32.012Z",
  blockHash: "0x...",
  blockNumber: 1071340,
  merchantAddress: "5CRkXP...",
} as const;

/** Deep clone the sample so per-test mutations don't leak. */
function cloneSample(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(SAMPLE_RECEIPT)) as Record<string, unknown>;
}

/** Capture the typed parse error for a payload, or fail if none thrown. */
function parseErrorFor(json: unknown): ReceiptParseError {
  try {
    parseReceipt(json);
  } catch (caught) {
    if (caught instanceof ReceiptParseError) return caught;
    throw caught;
  }
  throw new Error("expected parseReceipt to throw a ReceiptParseError");
}

function makeMemoryStore(initial: Record<string, string> = {}): KvStore & {
  raw: Map<string, string>;
} {
  const raw = new Map(Object.entries(initial));
  return {
    raw,
    async get(key) {
      return raw.has(key) ? raw.get(key)! : null;
    },
    async set(key, value) {
      raw.set(key, value);
    },
    async remove(key) {
      raw.delete(key);
    },
    async getJSON<T>(key: string) {
      const v = raw.get(key);
      if (v == null) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return null;
      }
    },
    async setJSON(key, value) {
      raw.set(key, JSON.stringify(value));
    },
  };
}

/** Minimal valid saved-receipt record keyed on `saleId`. */
function makeRecord(saleId: string, savedAt = "2026-06-02T10:00:00.000Z"): ReceiptRecord {
  const receipt = parseReceipt({
    v: 1,
    type: RECEIPT_QR_TYPE,
    saleId,
    amount: "1.00",
    asset: "CASH TOKEN",
    currency: "CASH TOKEN",
    taxRate: 19,
    business: { name: "Test GmbH" },
    items: [{ name: "Thing", quantity: 1, unitPrice: "1.00" }],
    issuedAt: savedAt,
  });
  return { receipt, savedAt };
}

describe("parseReceipt", () => {
  it("parses the exact sample payload into typed cents", () => {
    const r = parseReceipt(SAMPLE_RECEIPT);
    expect(r.version).toBe(RECEIPT_QR_VERSION);
    expect(r.saleId).toBe("01KSPY4NC1RD5FEA039Y5GQ8JR");
    expect(r.amountCents).toBe(750);
    expect(r.asset).toBe("CASH TOKEN");
    expect(r.currency).toBe("CASH TOKEN");
    expect(r.taxRatePercent).toBe(19);
    expect(r.issuedAt).toBe("2026-06-02T09:14:32.012Z");
  });

  it("parses an optional tip field into tipCents (undefined when absent)", () => {
    expect(parseReceipt(SAMPLE_RECEIPT).tipCents).toBeUndefined();
    const tipped = cloneSample();
    tipped.tip = "2.50";
    expect(parseReceipt(tipped).tipCents).toBe(250);
  });

  it("parses the business block", () => {
    const r = parseReceipt(SAMPLE_RECEIPT);
    expect(r.business.name).toBe("Funkhaus Berlin Events GmbH");
    expect(r.business.addressLine1).toBe("Nalepastraße 18");
    expect(r.business.addressLine2).toBe("12459 Berlin");
    expect(r.business.phone).toBe("030/12085416");
  });

  it("parses item lines with float-free unit prices", () => {
    const r = parseReceipt(SAMPLE_RECEIPT);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toEqual({ name: "Cappuccino", quantity: 1, unitPriceCents: 300 });
    expect(r.items[1]).toEqual({ name: "Currywurst", quantity: 1, unitPriceCents: 450 });
  });

  it("carries the optional block / merchant references", () => {
    const r = parseReceipt(SAMPLE_RECEIPT);
    expect(r.blockHash).toBe("0x...");
    expect(r.blockNumber).toBe(1071340);
    expect(r.merchantAddress).toBe("5CRkXP...");
  });

  it("omits optional references when absent", () => {
    const obj = cloneSample();
    delete obj.blockHash;
    delete obj.blockNumber;
    delete obj.merchantAddress;
    const r = parseReceipt(obj);
    expect(r.blockHash).toBeUndefined();
    expect(r.blockNumber).toBeUndefined();
    expect(r.merchantAddress).toBeUndefined();
  });

  it("rejects a non-object payload", () => {
    expect(parseErrorFor("nope").code).toBe("notObject");
    expect(parseErrorFor([1, 2, 3]).code).toBe("notObject");
    expect(parseErrorFor(null).code).toBe("notObject");
  });

  it("rejects the wrong type discriminant", () => {
    const obj = cloneSample();
    obj.type = "something-else";
    expect(parseErrorFor(obj).code).toBe("wrongType");
  });

  it("rejects an unsupported version (forward-compat guard)", () => {
    const obj = cloneSample();
    obj.v = 2;
    expect(parseErrorFor(obj).code).toBe("unsupportedVersion");
  });

  it("rejects a missing amount", () => {
    const obj = cloneSample();
    delete obj.amount;
    expect(parseErrorFor(obj).code).toBe("missingField");
  });

  it("rejects a missing saleId", () => {
    const obj = cloneSample();
    delete obj.saleId;
    expect(parseErrorFor(obj).code).toBe("missingField");
  });

  it("rejects a malformed amount", () => {
    const obj = cloneSample();
    obj.amount = "12,50";
    expect(parseErrorFor(obj).code).toBe("malformedAmount");
  });

  it("rejects a non-positive item quantity", () => {
    const obj = cloneSample();
    (obj.items as Array<Record<string, unknown>>)[0]!.quantity = 0;
    expect(parseErrorFor(obj).code).toBe("malformedItems");
  });

  it("rejects a non-decimal item unitPrice", () => {
    const obj = cloneSample();
    (obj.items as Array<Record<string, unknown>>)[0]!.unitPrice = "x";
    expect(parseErrorFor(obj).code).toBe("malformedItems");
  });

  it("accepts an empty items array (generic charge, no line items)", () => {
    const obj = cloneSample();
    obj.items = [];
    const r = parseReceipt(obj);
    expect(r.items).toEqual([]);
    // Amount still comes from the top-level field, not summed from items.
    expect(r.amountCents).toBe(750);
  });

  it("rejects items that is not an array", () => {
    const obj = cloneSample();
    (obj as unknown as Record<string, unknown>).items = "not-an-array";
    expect(parseErrorFor(obj).code).toBe("malformedItems");
  });

  it("accepts missing or empty business name as empty string", () => {
    const missing = cloneSample();
    missing.business = { addressLine1: "Somewhere 1" } as unknown as typeof missing.business;
    expect(parseReceipt(missing).business.name).toBe("");

    const empty = cloneSample();
    (empty.business as unknown as Record<string, unknown>).name = "";
    expect(parseReceipt(empty).business.name).toBe("");
  });
});

describe("parseReceiptQr", () => {
  it("round-trips the sample JSON string", () => {
    const r = parseReceiptQr(JSON.stringify(SAMPLE_RECEIPT));
    expect(r.amountCents).toBe(750);
  });

  it("surfaces invalid JSON as a typed ReceiptParseError", () => {
    try {
      parseReceiptQr("{not valid json");
      throw new Error("expected throw");
    } catch (caught) {
      expect(caught).toBeInstanceOf(ReceiptParseError);
      expect((caught as ReceiptParseError).code).toBe("notObject");
    }
  });
});

describe("parseDecimalToCents", () => {
  it("parses well-formed decimals into integer cents", () => {
    expect(parseDecimalToCents("7.50")).toBe(750);
    expect(parseDecimalToCents("3")).toBe(300);
    expect(parseDecimalToCents("0.05")).toBe(5);
    expect(parseDecimalToCents("1.5")).toBe(150);
    expect(parseDecimalToCents("0.00")).toBe(0);
  });

  it("rounds sub-cent precision (t3rminal pUSD amounts) to the nearest cent", () => {
    // t3rminal formats money from 6-decimal pUSD planck, so QR amounts carry
    // up to six fractional digits ("5.123456"). Receipts display whole cents
    // (the printed paper total does too), so the parser rounds half-up.
    expect(parseDecimalToCents("5.123456")).toBe(512);
    expect(parseDecimalToCents("16.666666")).toBe(1667);
    expect(parseDecimalToCents("1.234")).toBe(123);
    expect(parseDecimalToCents("1.235")).toBe(124);
    expect(parseDecimalToCents("9.999")).toBe(1000);
  });

  it("still rejects a non-digit character in the fractional part", () => {
    expect(() => parseDecimalToCents("1.2x")).toThrow(ReceiptParseError);
  });

  it("rejects non-digit characters", () => {
    expect(() => parseDecimalToCents("x")).toThrow(ReceiptParseError);
    expect(() => parseDecimalToCents("")).toThrow(ReceiptParseError);
  });

  it("tags the thrown error with the caller-supplied code", () => {
    try {
      parseDecimalToCents("x", "malformedItems");
      throw new Error("expected throw");
    } catch (caught) {
      expect((caught as ReceiptParseError).code).toBe("malformedItems");
    }
  });
});

describe("dispatchScannedPayload — receipts", () => {
  it("routes a t3rminal-receipt QR to the receipt branch", () => {
    const result = dispatchScannedPayload(JSON.stringify(SAMPLE_RECEIPT));
    expect(result.kind).toBe("receipt");
    if (result.kind === "receipt") {
      expect(result.payload.saleId).toBe("01KSPY4NC1RD5FEA039Y5GQ8JR");
      expect(result.payload.amountCents).toBe(750);
    }
  });

  it("keeps the existing embedded-claim JSON as embeddedQrJson (regression guard)", () => {
    const result = dispatchScannedPayload('{"version":0,"handoff":{"kind":"standard"}}');
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("embeddedQrJson");
    }
  });

  it("routes a receipt-typed payload with a bad amount to receiptInvalid", () => {
    const obj = cloneSample();
    obj.amount = "not-a-number";
    const result = dispatchScannedPayload(JSON.stringify(obj));
    expect(result.kind).toBe("receiptInvalid");
    if (result.kind === "receiptInvalid") {
      expect(result.error.code).toBe("malformedAmount");
    }
  });

  it("treats non-JSON brace garbage as embeddedQrJson", () => {
    const result = dispatchScannedPayload("{not valid json");
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("embeddedQrJson");
    }
  });
});

describe("saveReceipt / readReceipts", () => {
  it("returns an empty list for a null store or empty store", async () => {
    expect(await readReceipts(null)).toEqual([]);
    expect(await readReceipts(makeMemoryStore())).toEqual([]);
  });

  it("prepends saved receipts newest-first", async () => {
    const store = makeMemoryStore();
    await saveReceipt(store, makeRecord("A", "2026-06-02T08:00:00.000Z"));
    await saveReceipt(store, makeRecord("B", "2026-06-02T09:00:00.000Z"));
    const out = await readReceipts(store);
    expect(out.map((r) => r.receipt.saleId)).toEqual(["B", "A"]);
  });

  it("dedupes by saleId, refreshing the duplicate to the front", async () => {
    const store = makeMemoryStore();
    await saveReceipt(store, makeRecord("A", "2026-06-02T08:00:00.000Z"));
    await saveReceipt(store, makeRecord("B", "2026-06-02T09:00:00.000Z"));
    await saveReceipt(store, makeRecord("A", "2026-06-02T10:00:00.000Z"));
    const out = await readReceipts(store);
    expect(out.map((r) => r.receipt.saleId)).toEqual(["A", "B"]);
    // The refreshed copy carries the latest savedAt, not the original.
    expect(out[0]!.savedAt).toBe("2026-06-02T10:00:00.000Z");
  });

  it("honors the entry cap, trimming the oldest tail", async () => {
    const cap = envConfig.storage.receiptsMaxEntries;
    // Seed the store at the cap (newest-first), then save one more.
    const seeded = Array.from({ length: cap }, (_, i) => makeRecord(`seed-${i}`));
    const store = makeMemoryStore({
      [RECEIPTS_KEY]: JSON.stringify({
        schemaVersion: envConfig.storage.receiptsSchemaVersion,
        entries: seeded,
      }),
    });
    await saveReceipt(store, makeRecord("fresh"));
    const out = await readReceipts(store);
    expect(out.length).toBe(cap);
    expect(out[0]!.receipt.saleId).toBe("fresh");
    // The oldest tail entry (last in a newest-first list) is dropped.
    expect(out.some((r) => r.receipt.saleId === `seed-${cap - 1}`)).toBe(false);
  });

  it("drops the envelope on a schema-version mismatch", async () => {
    const store = makeMemoryStore({
      [RECEIPTS_KEY]: JSON.stringify({
        schemaVersion: 999,
        entries: [makeRecord("X")],
      }),
    });
    expect(await readReceipts(store)).toEqual([]);
  });
});

describe("itemLineTotalCents", () => {
  it("multiplies unit price by quantity", () => {
    expect(itemLineTotalCents({ unitPriceCents: 450, quantity: 3 })).toBe(1350);
    expect(itemLineTotalCents({ unitPriceCents: 0, quantity: 5 })).toBe(0);
  });
});

describe("receiptTaxCents", () => {
  it("backs the included tax out of a gross amount", () => {
    expect(receiptTaxCents(11900, 19)).toBe(1900);
    expect(receiptTaxCents(1070, 7)).toBe(70);
  });
  it("rounds to whole cents", () => {
    expect(receiptTaxCents(100, 19)).toBe(16);
  });
  it("returns 0 for a non-positive or non-finite rate", () => {
    expect(receiptTaxCents(1000, 0)).toBe(0);
    expect(receiptTaxCents(1000, -5)).toBe(0);
    expect(receiptTaxCents(1000, Number.NaN)).toBe(0);
  });
  it("throws on non-integer cents", () => {
    expect(() => receiptTaxCents(100.5, 19)).toThrow(TypeError);
  });
});

/**
 * Real-world payloads from production scans — locked in so future
 * parser changes can't silently re-break the formats we've already
 * verified work end-to-end.
 */
describe("real-world t3rminal-receipt payloads", () => {
  it("parses a generic-charge receipt with no line items", () => {
    // Krusty Krab pizza, 5.50 CASH TOKEN, items: [] — exact payload from a
    // June-2026 production scan that previously failed `malformedItems`.
    const raw = `{"v":1,"type":"t3rminal-receipt","saleId":"01KT72Z0VCY8F6EB56SZZCGHF3","amount":"5.5","asset":"CASH TOKEN","currency":"CASH TOKEN","taxRate":19,"business":{"name":"Krusty Krab Pizza","addressLine1":"12 Bikiini Bottom","addressLine2":"12459 Berlin","phone":"0112312312"},"items":[],"issuedAt":"2026-06-03T15:52:19.052Z","blockHash":"0x1c9d4bc02143a0d081cdc47a0aa9375e20687567ddfd56ea427bfe6f231cfeeb","blockNumber":302047,"merchantAddress":"5DfXxr1Npfj42NDof2SFvMZ9DAWifjgA5NHTdb3FtjYpj7hr"}`;
    const r = parseReceiptQr(raw);
    expect(r.saleId).toBe("01KT72Z0VCY8F6EB56SZZCGHF3");
    expect(r.amountCents).toBe(550);
    expect(r.items).toEqual([]);
    expect(r.business.name).toBe("Krusty Krab Pizza");
    expect(r.merchantAddress).toBe("5DfXxr1Npfj42NDof2SFvMZ9DAWifjgA5NHTdb3FtjYpj7hr");
  });

  it("parses an itemized receipt whose pUSD amounts carry sub-cent precision", () => {
    // A dense, itemized t3rminal receipt: `formatAmountFromPlanck` (6-decimal
    // pUSD) emits up to six fractional digits — e.g. "16.666666". The strict
    // ≤2-decimal parser used to reject these as `malformedAmount` /
    // `malformedItems`, dead-ending the scan on "Couldn't read that receipt".
    const raw = `{"v":1,"type":"t3rminal-receipt","saleId":"01KT9P4M2QF8RA6N0V3K7E5XYZ","amount":"16.666666","asset":"CASH TOKEN","currency":"CASH TOKEN","taxRate":19,"business":{"name":"Funkhaus Berlin Events GmbH","addressLine1":"Nalepastraße 18","addressLine2":"12459 Berlin","phone":"030/12085416"},"items":[{"name":"Filterkaffee","quantity":3,"unitPrice":"2.333333"},{"name":"Mehrkornbrötchen","quantity":2,"unitPrice":"4.833334"}],"issuedAt":"2026-06-10T09:14:32.012Z","blockHash":"0x1c9d4bc02143a0d081cdc47a0aa9375e20687567ddfd56ea427bfe6f231cfeeb","blockNumber":1071340,"merchantAddress":"5DfXxr1Npfj42NDof2SFvMZ9DAWifjgA5NHTdb3FtjYpj7hr"}`;
    const r = parseReceiptQr(raw);
    expect(r.amountCents).toBe(1667);
    expect(r.items.map((i) => i.unitPriceCents)).toEqual([233, 483]);
    // The full scan path resolves to a savable receipt, not `receiptInvalid`.
    expect(dispatchScannedPayload(raw).kind).toBe("receipt");
  });
});

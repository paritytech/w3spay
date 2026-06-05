/**
 * Parser for `t3rminal-receipt` QR codes — a digital copy of a printed
 * purchase receipt (cash or otherwise). Strict, total, allocation-light:
 * returns a single typed `ParsedReceipt` record or throws a typed
 * `ReceiptParseError`. W3sPay is the *consumer* of this wire format; the
 * generator lives terminal-side and is out of scope here.
 *
 * The wire format is a JSON object:
 *
 *   {
 *     "v": 1, "type": "t3rminal-receipt",
 *     "saleId": "01KSPY…", "amount": "7.50",
 *     "asset": "CASH", "currency": "CASH", "taxRate": 19,
 *     "business": { "name": …, "addressLine1"?: …, "addressLine2"?: …, "phone"?: … },
 *     "items": [ { "name": …, "quantity": 1, "unitPrice": "3.00" }, … ],
 *     "issuedAt": "2026-06-02T09:14:32.012Z",
 *     "blockHash"?: "0x…", "blockNumber"?: 1071340, "merchantAddress"?: "5CRkXP…"
 *   }
 *
 * Forward compatibility is gated on `v`: a receipt whose version we don't
 * recognise is rejected (`unsupportedVersion`) rather than mis-parsed
 * against a shape that may have shifted.
 *
 * Money fields (`amount`, item `unitPrice`) are decimal strings normalised
 * to **integer minor units (cents)** — the parser never returns a
 * floating-point amount, for the same reason `tse-parser.ts` doesn't:
 * float drift on values like `19.99` is exactly the class of bug we
 * cannot tolerate on a number the customer reads off a receipt.
 */

export const RECEIPT_QR_TYPE = "t3rminal-receipt";
export const RECEIPT_QR_VERSION = 1;

export interface ReceiptItem {
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

export interface ReceiptBusiness {
  readonly name: string;
  readonly addressLine1?: string;
  readonly addressLine2?: string;
  readonly phone?: string;
}

export interface ParsedReceipt {
  readonly version: number;
  readonly saleId: string;
  readonly amountCents: number;
  readonly asset: string;
  readonly currency: string;
  readonly taxRatePercent: number;
  readonly business: ReceiptBusiness;
  readonly items: readonly ReceiptItem[];
  readonly issuedAt: string;
  readonly blockHash?: string;
  readonly blockNumber?: number;
  readonly merchantAddress?: string;
}

export class ReceiptParseError extends Error {
  constructor(
    public readonly code: ReceiptParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReceiptParseError";
  }
}

export type ReceiptParseErrorCode =
  | "notObject"
  | "wrongType"
  | "unsupportedVersion"
  | "missingField"
  | "malformedAmount"
  | "malformedItems";

/** Narrow record alias — every field is `unknown` until validated. */
type RawObject = Record<string, unknown>;

/**
 * Parse + validate an already-decoded receipt payload. `json` is the
 * `unknown` result of a `JSON.parse` (the dispatcher parses once and
 * hands the object in; `parseReceiptQr` is the parse-then-validate
 * convenience for direct callers).
 */
export function parseReceipt(json: unknown): ParsedReceipt {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new ReceiptParseError("notObject", "receipt payload is not a JSON object");
  }
  const obj = json as RawObject;

  if (obj.type !== RECEIPT_QR_TYPE) {
    throw new ReceiptParseError(
      "wrongType",
      `expected type "${RECEIPT_QR_TYPE}", got ${describe(obj.type)}`,
    );
  }
  if (obj.v !== RECEIPT_QR_VERSION) {
    throw new ReceiptParseError(
      "unsupportedVersion",
      `unsupported receipt version ${describe(obj.v)} — only v${RECEIPT_QR_VERSION} is accepted`,
    );
  }

  const saleId = requireNonEmptyString(obj, "saleId");
  const asset = requireNonEmptyString(obj, "asset");
  const currency = requireNonEmptyString(obj, "currency");
  const issuedAt = requireNonEmptyString(obj, "issuedAt");
  const amountCents = parseDecimalToCents(requireNonEmptyString(obj, "amount"));
  const taxRatePercent = requireFiniteNumber(obj, "taxRate");

  return {
    version: RECEIPT_QR_VERSION,
    saleId,
    amountCents,
    asset,
    currency,
    taxRatePercent,
    business: parseBusiness(obj.business),
    items: parseItems(obj.items),
    issuedAt,
    blockHash: optionalString(obj.blockHash),
    blockNumber: optionalFiniteNumber(obj.blockNumber),
    merchantAddress: optionalString(obj.merchantAddress),
  };
}

/**
 * `JSON.parse` + `parseReceipt`. Total: a non-JSON string surfaces as a
 * `ReceiptParseError("notObject")` rather than a raw `SyntaxError`, so
 * callers only ever catch the one error type.
 */
export function parseReceiptQr(raw: string): ParsedReceipt {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ReceiptParseError("notObject", "receipt payload is not valid JSON");
  }
  return parseReceipt(json);
}

function parseBusiness(value: unknown): ReceiptBusiness {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReceiptParseError("missingField", "business must be an object");
  }
  const obj = value as RawObject;
  return {
    name: optionalString(obj.name) ?? "",
    addressLine1: optionalString(obj.addressLine1),
    addressLine2: optionalString(obj.addressLine2),
    phone: optionalString(obj.phone),
  };
}

function parseItems(value: unknown): readonly ReceiptItem[] {
  // Empty arrays are accepted: a receipt may be a generic charge with
  // no itemised lines. The receipt total comes from the top-level
  // `amount` field, not from summing items, so an empty list doesn't
  // change the customer-signing semantics.
  if (!Array.isArray(value)) {
    throw new ReceiptParseError("malformedItems", "items must be an array");
  }
  const items: ReceiptItem[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i] as unknown;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ReceiptParseError("malformedItems", `item ${i} is not an object`);
    }
    const obj = entry as RawObject;
    const name = obj.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new ReceiptParseError("malformedItems", `item ${i} is missing a name`);
    }
    const quantity = obj.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) {
      throw new ReceiptParseError(
        "malformedItems",
        `item ${i} quantity must be a positive integer, got ${describe(quantity)}`,
      );
    }
    if (typeof obj.unitPrice !== "string") {
      throw new ReceiptParseError(
        "malformedItems",
        `item ${i} unitPrice must be a decimal string, got ${describe(obj.unitPrice)}`,
      );
    }
    items.push({
      name: name.trim(),
      quantity,
      unitPriceCents: parseDecimalToCents(obj.unitPrice, "malformedItems"),
    });
  }
  return items;
}

/**
 * Parse a decimal money string (e.g. `"7.50"`, `"3"`, `"0.05"`) into
 * integer cents. The format pins `.` as the decimal separator and at
 * most two fractional digits — no thousands separator, no `,`-locale.
 * Float-free: digits are accumulated by character so values like
 * `"19.99"` never round-trip through an IEEE-754 double.
 *
 * `code` tags the thrown error with the caller's domain (`malformedAmount`
 * for the receipt total, `malformedItems` for an item line) so the
 * dispatcher's `receiptInvalid` carries a meaningful reason.
 */
export function parseDecimalToCents(
  raw: string,
  code: ReceiptParseErrorCode = "malformedAmount",
): number {
  if (raw.length === 0) {
    throw new ReceiptParseError(code, "empty amount field");
  }
  let cursor = 0;
  let sign = 1;
  if (raw[0] === "-") {
    sign = -1;
    cursor = 1;
  } else if (raw[0] === "+") {
    cursor = 1;
  }
  let whole = 0;
  let sawDigit = false;
  while (cursor < raw.length && raw[cursor] !== ".") {
    const digit = raw.charCodeAt(cursor) - 0x30;
    if (digit < 0 || digit > 9) {
      throw new ReceiptParseError(
        code,
        `non-digit character "${raw[cursor]}" in integer part of "${raw}"`,
      );
    }
    whole = whole * 10 + digit;
    sawDigit = true;
    cursor += 1;
  }
  let cents = 0;
  if (cursor < raw.length) {
    cursor += 1; // skip '.'
    let consumed = 0;
    while (cursor < raw.length && consumed < 2) {
      const digit = raw.charCodeAt(cursor) - 0x30;
      if (digit < 0 || digit > 9) {
        throw new ReceiptParseError(
          code,
          `non-digit character "${raw[cursor]}" in fractional part of "${raw}"`,
        );
      }
      cents = cents * 10 + digit;
      consumed += 1;
      cursor += 1;
      sawDigit = true;
    }
    if (consumed === 1) cents *= 10; // "1.5" => 150 cents
    if (cursor < raw.length) {
      throw new ReceiptParseError(
        code,
        `unexpected extra digits past two decimals in "${raw}"`,
      );
    }
  }
  if (!sawDigit) {
    throw new ReceiptParseError(code, `no digits in amount "${raw}"`);
  }
  return sign * (whole * 100 + cents);
}

function requireNonEmptyString(obj: RawObject, key: string, label = key): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ReceiptParseError(
      "missingField",
      `missing or empty required field "${label}"`,
    );
  }
  return value.trim();
}

function requireFiniteNumber(obj: RawObject, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ReceiptParseError(
      "missingField",
      `field "${key}" must be a finite number, got ${describe(value)}`,
    );
  }
  return value;
}

/**
 * Optional display string: present non-empty strings are trimmed and
 * kept; anything else (absent, empty, wrong type) is omitted. Optional
 * fields are best-effort context, so a non-string value drops the field
 * rather than failing the whole parse.
 */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Compact, allocation-light value descriptor for error messages. */
function describe(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return String(value);
}

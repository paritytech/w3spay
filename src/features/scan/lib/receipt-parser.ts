// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Parser for `t3rminal-receipt` QR codes — a digital receipt copy. Strict,
 * total, allocation-light: returns ParsedReceipt or throws ReceiptParseError.
 * W3sPay only consumes this format; the generator lives terminal-side.
 *
 * Wire format — a JSON object:
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
 * Unknown `v` is rejected (`unsupportedVersion`), never mis-parsed against a
 * shape that may have shifted. Money fields (`amount`, item `unitPrice`) are
 * decimal strings normalised to integer cents — never float, to avoid drift
 * on values like `19.99` (same reason as tse-parser.ts).
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
 * Parse + validate an already-decoded receipt payload (`unknown` from
 * JSON.parse). The dispatcher parses once and hands the object in;
 * parseReceiptQr is the parse-then-validate convenience for direct callers.
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
  // Empty arrays are accepted: the total comes from the top-level `amount`
  // field, not from summing items, so an empty list is fine for signing.
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

/** Wire-format query keys (abbreviated for QR density). Single source of truth. */
export const PARAM = {
  version: "v",
  saleId: "id",
  amount: "a",
  asset: "as",
  currency: "c",
  taxRate: "t",
  issuedAt: "ts",
  businessName: "bn",
  businessAddressLine1: "a1",
  businessAddressLine2: "a2",
  businessPhone: "tel",
  item: "i",
  blockHash: "bh",
  blockNumber: "bk",
  merchantAddress: "m",
} as const;

/**
 * Detect a save-receipt deeplink by scheme + path, regardless of the configured
 * product domain. Slices at the first `?`, so it matches the canonical fragment
 * form (`…/#/save-receipt?…`) and the legacy path form alike.
 */
export function isSaveReceiptUrl(raw: string): boolean {
  const q = raw.indexOf("?");
  const path = q >= 0 ? raw.slice(0, q) : raw;
  return path.startsWith("polkadotapp://") && path.endsWith("/save-receipt");
}

/** Parse a save-receipt deeplink URL into a ParsedReceipt; throws ReceiptParseError. */
export function parseSaveReceiptUrl(raw: string): ParsedReceipt {
  const q = raw.indexOf("?");
  return parseSaveReceiptParams(new URLSearchParams(q >= 0 ? raw.slice(q + 1) : ""));
}

/**
 * Validate save-receipt query params into a ParsedReceipt. Shared by the QR
 * path (`parseSaveReceiptUrl`) and the boot deep-link consumer, which receives
 * the query from the SPA launch URL instead.
 */
export function parseSaveReceiptParams(params: URLSearchParams): ParsedReceipt {
  const version = params.get(PARAM.version);
  if (version !== String(RECEIPT_QR_VERSION)) {
    throw new ReceiptParseError(
      "unsupportedVersion",
      `unsupported receipt version ${version === null ? "<missing>" : `"${version}"`} — only v${RECEIPT_QR_VERSION} is accepted`,
    );
  }
  const saleId = requireParam(params, PARAM.saleId);
  const asset = requireParam(params, PARAM.asset);
  const currency = requireParam(params, PARAM.currency);
  const issuedAt = requireParam(params, PARAM.issuedAt);
  const amountCents = parseDecimalToCents(requireParam(params, PARAM.amount));
  const taxRatePercent = Number(requireParam(params, PARAM.taxRate));
  if (!Number.isFinite(taxRatePercent)) {
    throw new ReceiptParseError(
      "missingField",
      `parameter "${PARAM.taxRate}" must be a finite number`,
    );
  }
  const blockNumberRaw = optionalParam(params, PARAM.blockNumber);
  const blockNumber =
    blockNumberRaw !== undefined && Number.isFinite(Number(blockNumberRaw))
      ? Number(blockNumberRaw)
      : undefined;
  return {
    version: RECEIPT_QR_VERSION,
    saleId,
    amountCents,
    asset,
    currency,
    taxRatePercent,
    business: {
      name: optionalParam(params, PARAM.businessName) ?? "",
      addressLine1: optionalParam(params, PARAM.businessAddressLine1),
      addressLine2: optionalParam(params, PARAM.businessAddressLine2),
      phone: optionalParam(params, PARAM.businessPhone),
    },
    items: params.getAll(PARAM.item).map(parseItemSpec),
    issuedAt,
    blockHash: optionalParam(params, PARAM.blockHash),
    blockNumber,
    merchantAddress: optionalParam(params, PARAM.merchantAddress),
  };
}

/** Parse one repeated `item` value: `name|quantity|unitPrice`. */
function parseItemSpec(spec: string, index: number): ReceiptItem {
  const parts = spec.split("|");
  if (parts.length < 3) {
    throw new ReceiptParseError(
      "malformedItems",
      `item ${index} must be "name|quantity|unitPrice", got "${spec}"`,
    );
  }
  const name = parts[0]!.trim();
  if (name.length === 0) {
    throw new ReceiptParseError("malformedItems", `item ${index} is missing a name`);
  }
  const quantity = Number(parts[1]);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ReceiptParseError(
      "malformedItems",
      `item ${index} quantity must be a positive integer, got "${parts[1]}"`,
    );
  }
  return {
    name,
    quantity,
    unitPriceCents: parseDecimalToCents(parts[2]!, "malformedItems"),
  };
}

/** Required query param: trimmed, non-empty, else `missingField`. */
function requireParam(params: URLSearchParams, key: string): string {
  const value = params.get(key);
  const trimmed = value === null ? "" : value.trim();
  if (trimmed.length === 0) {
    throw new ReceiptParseError(
      "missingField",
      `missing or empty required parameter "${key}"`,
    );
  }
  return trimmed;
}

/** Optional display param: trimmed if present and non-empty, else omitted. */
function optionalParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Parse a decimal money string (e.g. `"7.50"`, `"3"`, `"5.123456"`) into
 * integer cents. Pins the `.` separator — no thousands separator, no `,`
 * locale. The first two fractional digits are whole cents; any further digits
 * are sub-cent precision (t3rminal formats money from 6-decimal pUSD planck)
 * and round half-up to the nearest cent, matching the printed paper receipt.
 * Float-free: digits are accumulated by character so `"19.99"` never
 * round-trips through an IEEE-754 double.
 *
 * `code` tags the error with the caller's domain (`malformedAmount` for the
 * total, `malformedItems` for an item line) for a meaningful dispatcher reason.
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
    cursor += 1; // step past the "."
    let consumed = 0;
    let roundUp = false;
    while (cursor < raw.length) {
      const digit = raw.charCodeAt(cursor) - 0x30;
      if (digit < 0 || digit > 9) {
        throw new ReceiptParseError(
          code,
          `non-digit character "${raw[cursor]}" in fractional part of "${raw}"`,
        );
      }
      // First two fractional digits are whole cents; the third decides a
      // round-half-up. t3rminal emits up to six fractional digits (6-decimal
      // pUSD), so we consume the rest as sub-cent precision rather than
      // rejecting the whole receipt.
      if (consumed < 2) {
        cents = cents * 10 + digit;
      } else if (consumed === 2 && digit >= 5) {
        roundUp = true;
      }
      consumed += 1;
      cursor += 1;
      sawDigit = true;
    }
    if (consumed === 1) cents *= 10; // "1.5" => 150 cents
    if (roundUp) cents += 1; // carry into `whole` handled by `whole * 100 + cents`
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
 * Optional display string: trimmed if a non-empty string, else omitted.
 * Optional fields are best-effort context, so a bad value drops the field
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

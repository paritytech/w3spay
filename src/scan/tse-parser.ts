/**
 * Parser for German fiscal TSE QR codes (BSI TR-03151 / KassenSichV §6 /
 * DSFinV-K §4.2). Strict, total, allocation-light: returns a single typed
 * record or throws a typed parse error. Signature verification is *not*
 * performed in v1 — the `signature` and `publicKey` fields are surfaced raw
 * so the v2 ECDSA-over-BSI-TR-03116 verifier can consume them without
 * re-parsing.
 *
 * The QR wire format is:
 *
 *   V0;<kassen-seriennummer>;<processType>;<processData>;
 *   <transaktions-nummer>;<signatur-zaehler>;<start-zeit>;<log-time>;
 *   <sig-alg>;<log-time-format>;<signatur>;<public-key>
 *
 * Twelve fields, semicolon-delimited, prefix-anchored on `V0;`.
 *
 * `processData` for a `Kassenbeleg-V1` is itself a structured string:
 *
 *   Beleg^<vat19>_<vat7>_<vatExempt>_<vat19part>_<vatreduced>^<paymentSplit>
 *
 * The five gross totals (one per VAT class) sum to the receipt total in
 * EUR. The trailing `<paymentSplit>` is `Bar:<eur>` (cash), `Unbar:<eur>`
 * (non-cash), or both joined by `|`. We do not assert on the split — a
 * cash payment is the expected case but the parser stays format-correct
 * for non-cash receipts too.
 *
 * EUR amounts are returned in **cents** (integer, smallest unit). The
 * parser never returns a floating-point amount: float drift on values
 * like `19.99` is exactly the class of bug we cannot tolerate when the
 * customer is signing a payment for the displayed number.
 */

const TSE_PREFIX = "V0";
const KASSENBELEG_V1 = "Kassenbeleg-V1";
const EXPECTED_FIELD_COUNT = 12;

export interface ParsedTseQr {
  readonly kassenSerial: string;
  readonly processType: string;
  readonly amountEurCents: number;
  readonly vatBreakdownEurCents: VatBreakdown;
  readonly transactionNumber: string;
  readonly signatureCounter: string;
  readonly startTime: string;
  readonly logTime: string;
  readonly sigAlgorithm: string;
  readonly logTimeFormat: string;
  /** ECDSA signature, base64 — unused in v1, parsed for v2 verifier. */
  readonly signatureBase64: string;
  /** TSE public key, base64 — unused in v1, parsed for v2 verifier. */
  readonly publicKeyBase64: string;
}

export interface VatBreakdown {
  /** Field 1: VAT 19% (Regelsteuersatz) gross total, cents. */
  readonly vat19Cents: number;
  /** Field 2: VAT 7% (ermäßigt) gross total, cents. */
  readonly vat7Cents: number;
  /** Field 3: VAT exempt (umsatzsteuerfrei) gross total, cents. */
  readonly vatExemptCents: number;
  /**
   * Field 4: VAT 19% Teilbetrag (deprecated; reserved for legacy 10.7%
   * Durchschnittssatz). Almost always zero on modern receipts.
   */
  readonly vat19PartCents: number;
  /**
   * Field 5: VAT 5.5% / Durchschnittssatz (deprecated; reserved for
   * Land-/Forstwirtschaft Durchschnittssatz). Almost always zero.
   */
  readonly vatReducedCents: number;
}

export class TseParseError extends Error {
  constructor(
    public readonly code: TseParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TseParseError";
  }
}

export type TseParseErrorCode =
  | "wrongPrefix"
  | "wrongFieldCount"
  | "unsupportedProcessType"
  | "malformedProcessData"
  | "malformedAmount"
  | "nonPositiveAmount";

export function parseTseQr(raw: string): ParsedTseQr {
  const fields = raw.split(";");
  if (fields.length !== EXPECTED_FIELD_COUNT) {
    throw new TseParseError(
      "wrongFieldCount",
      `expected ${EXPECTED_FIELD_COUNT} semicolon-delimited fields, got ${fields.length}`,
    );
  }
  if (fields[0] !== TSE_PREFIX) {
    throw new TseParseError(
      "wrongPrefix",
      `expected prefix "${TSE_PREFIX}" as first field, got "${fields[0]}"`,
    );
  }
  const [
    ,
    kassenSerial,
    processType,
    processData,
    transactionNumber,
    signatureCounter,
    startTime,
    logTime,
    sigAlgorithm,
    logTimeFormat,
    signatureBase64,
    publicKeyBase64,
  ] = fields;

  if (processType !== KASSENBELEG_V1) {
    throw new TseParseError(
      "unsupportedProcessType",
      `unsupported processType "${processType}" — only "${KASSENBELEG_V1}" is accepted`,
    );
  }

  const breakdown = parseProcessDataVatTotals(processData);
  const amountEurCents =
    breakdown.vat19Cents +
    breakdown.vat7Cents +
    breakdown.vatExemptCents +
    breakdown.vat19PartCents +
    breakdown.vatReducedCents;
  if (amountEurCents <= 0) {
    throw new TseParseError(
      "nonPositiveAmount",
      `receipt total must be positive, got ${amountEurCents} cents`,
    );
  }

  return {
    kassenSerial,
    processType,
    amountEurCents,
    vatBreakdownEurCents: breakdown,
    transactionNumber,
    signatureCounter,
    startTime,
    logTime,
    sigAlgorithm,
    logTimeFormat,
    signatureBase64,
    publicKeyBase64,
  };
}

/**
 * `processData` for a Kassenbeleg-V1 has the shape:
 *
 *   Beleg^<vat19>_<vat7>_<vatExempt>_<vat19part>_<vatreduced>^<paymentSplit>
 *
 * The three `^`-delimited sections are: token ("Beleg"), VAT-class totals,
 * payment split. The five `_`-delimited totals are EUR decimals with `.`
 * as separator (per BSI TR-03151 §B.6.2). Returns the totals in cents.
 *
 * Throws TseParseError("malformedProcessData") on any structural deviation
 * — five totals, exactly four underscores, all parseable as decimal EUR.
 */
function parseProcessDataVatTotals(processData: string): VatBreakdown {
  const sections = processData.split("^");
  if (sections.length < 2 || sections[0] !== "Beleg") {
    throw new TseParseError(
      "malformedProcessData",
      `processData must start with "Beleg^…", got "${processData}"`,
    );
  }
  const totalsRaw = sections[1] ?? "";
  const totals = totalsRaw.split("_");
  if (totals.length !== 5) {
    throw new TseParseError(
      "malformedProcessData",
      `expected 5 VAT-class totals separated by "_", got ${totals.length} in "${totalsRaw}"`,
    );
  }
  const [vat19, vat7, vatExempt, vat19Part, vatReduced] = totals;
  return {
    vat19Cents: parseEurDecimalToCents(vat19),
    vat7Cents: parseEurDecimalToCents(vat7),
    vatExemptCents: parseEurDecimalToCents(vatExempt),
    vat19PartCents: parseEurDecimalToCents(vat19Part),
    vatReducedCents: parseEurDecimalToCents(vatReduced),
  };
}

/**
 * Parse a TSE-emitted EUR decimal (e.g. `"2.55"`, `"0.00"`) into integer
 * cents. The TSE format pins `.` as the decimal separator and up to two
 * fractional digits. Anything else is malformed: no thousands separator,
 * no `,`-style locale.
 */
function parseEurDecimalToCents(raw: string): number {
  if (raw.length === 0) {
    throw new TseParseError("malformedAmount", "empty amount field");
  }
  let cursor = 0;
  let sign = 1;
  if (raw[0] === "-") {
    sign = -1;
    cursor = 1;
  } else if (raw[0] === "+") {
    cursor = 1;
  }
  let euros = 0;
  let sawDigit = false;
  while (cursor < raw.length && raw[cursor] !== ".") {
    const digit = raw.charCodeAt(cursor) - 0x30;
    if (digit < 0 || digit > 9) {
      throw new TseParseError(
        "malformedAmount",
        `non-digit character "${raw[cursor]}" in integer part of "${raw}"`,
      );
    }
    euros = euros * 10 + digit;
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
        throw new TseParseError(
          "malformedAmount",
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
      throw new TseParseError(
        "malformedAmount",
        `unexpected extra digits past two decimals in "${raw}"`,
      );
    }
  }
  if (!sawDigit) {
    throw new TseParseError("malformedAmount", `no digits in amount "${raw}"`);
  }
  return sign * (euros * 100 + cents);
}

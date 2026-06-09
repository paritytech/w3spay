// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Detect the wire format of a decoded QR payload and dispatch to the right
 * parser.
 *
 * Format-sniff rules (§6.4):
 *   - "V0;"               → BSI TR-03151 / KassenSichV §6 TSE QR (Branch A)
 *   - "polkadotapp://pay" → polkadot-pay deeplink (parsed here)
 *   - "polkadotapp://…/#/save-receipt" → save-receipt deeplink (parsed here)
 *   - "polkadot:"         → SS58 URI scheme (not handled)
 *   - leading "{"         → JSON object. `type: "t3rminal-receipt"` is a
 *                          scanned purchase receipt (parsed here); any
 *                          other JSON stays an unhandled embeddedQr claim.
 *   - anything else       → unknown
 */

import { parseTseQr, type ParsedTseQr, TseParseError } from "@/features/scan/lib/tse-parser.ts";
import {
  parseTerminalPayQr,
  type ParsedTerminalPayQr,
  TerminalPayParseError,
} from "@/features/scan/lib/terminal-pay-parser.ts";
import {
  parseReceipt,
  isSaveReceiptUrl,
  parseSaveReceiptUrl,
  ReceiptParseError,
  RECEIPT_QR_TYPE,
  type ParsedReceipt,
} from "@/features/scan/lib/receipt-parser.ts";

export type UnsupportedReason =
  | "polkadotUriScheme"
  | "embeddedQrJson"
  | "empty"
  | "unknownFormat";

export type ScanResult =
  | { kind: "tse"; payload: ParsedTseQr }
  | { kind: "terminalPay"; payload: ParsedTerminalPayQr }
  | { kind: "receipt"; payload: ParsedReceipt }
  | { kind: "receiptInvalid"; error: ReceiptParseError; raw: string }
  | { kind: "unsupported"; reason: UnsupportedReason; raw: string }
  | { kind: "invalid"; error: Error; raw: string };

export function dispatchScannedPayload(raw: string): ScanResult {
  if (raw.length === 0) {
    return { kind: "unsupported", reason: "empty", raw };
  }
  if (raw.startsWith("V0;")) {
    try {
      return { kind: "tse", payload: parseTseQr(raw) };
    } catch (caught) {
      if (caught instanceof TseParseError) {
        return { kind: "invalid", error: caught, raw };
      }
      throw caught;
    }
  }
  if (isSaveReceiptUrl(raw)) {
    try {
      return { kind: "receipt", payload: parseSaveReceiptUrl(raw) };
    } catch (caught) {
      if (caught instanceof ReceiptParseError) {
        return { kind: "receiptInvalid", error: caught, raw };
      }
      throw caught;
    }
  }
  if (raw.startsWith("polkadotapp://pay")) {
    try {
      return { kind: "terminalPay", payload: parseTerminalPayQr(raw) };
    } catch (caught) {
      if (caught instanceof TerminalPayParseError) {
        return { kind: "invalid", error: caught, raw };
      }
      throw caught;
    }
  }
  if (raw.startsWith("polkadot:")) {
    return { kind: "unsupported", reason: "polkadotUriScheme", raw };
  }
  if (raw.startsWith("{")) {
    // Leading "{" is JSON: parse once and sniff `type`. A t3rminal receipt is
    // parsed here; everything else keeps the legacy "embedded SDK claim"
    // classification to preserve existing handoff-JSON behaviour.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: "unsupported", reason: "embeddedQrJson", raw };
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === RECEIPT_QR_TYPE
    ) {
      try {
        return { kind: "receipt", payload: parseReceipt(parsed) };
      } catch (caught) {
        if (caught instanceof ReceiptParseError) {
          return { kind: "receiptInvalid", error: caught, raw };
        }
        throw caught;
      }
    }
    return { kind: "unsupported", reason: "embeddedQrJson", raw };
  }
  return { kind: "unsupported", reason: "unknownFormat", raw };
}

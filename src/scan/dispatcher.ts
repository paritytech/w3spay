/**
 * Detect the wire format of a decoded QR payload and dispatch to the right
 * parser. Tomorrow-MVP only recognises Branch A (German fiscal TSE QR);
 * the other format hints are returned as unrecognised with a stable label
 * so the UI can render a clear "we don't recognise this QR" error instead
 * of an opaque parse failure.
 *
 * Format-sniff rules (§6.4):
 *   - "V0;"               → BSI TR-03151 / KassenSichV §6 TSE QR (Branch A)
 *   - "polkadotapp://pay" → legacy t3rminal wallet deeplink (not handled)
 *   - "polkadot:"         → SS58 URI scheme (not handled)
 *   - leading "{"         → SDK embeddedQr claim JSON (not handled)
 *   - anything else       → unknown
 */

import { parseTseQr, type ParsedTseQr, TseParseError } from "./tse-parser.ts";

export type ScanResult =
  | { kind: "tse"; payload: ParsedTseQr }
  | { kind: "unsupported"; reason: UnsupportedReason; raw: string }
  | { kind: "invalid"; error: TseParseError; raw: string };

export type UnsupportedReason =
  | "legacyPolkadotappDeeplink"
  | "polkadotUriScheme"
  | "embeddedQrJson"
  | "empty"
  | "unknownFormat";

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
  if (raw.startsWith("polkadotapp://pay")) {
    return { kind: "unsupported", reason: "legacyPolkadotappDeeplink", raw };
  }
  if (raw.startsWith("polkadot:")) {
    return { kind: "unsupported", reason: "polkadotUriScheme", raw };
  }
  if (raw.startsWith("{")) {
    return { kind: "unsupported", reason: "embeddedQrJson", raw };
  }
  return { kind: "unsupported", reason: "unknownFormat", raw };
}

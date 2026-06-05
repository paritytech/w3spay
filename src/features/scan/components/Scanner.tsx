import type { ComponentType } from "react";

import { isIOS } from "@/shared/api/host";

import { WasmScanner } from "@/features/scan/components/WasmScanner.tsx";
import type { ScannerError } from "@/features/scan/lib/scanner-types.ts";

export interface ScannerProps {
  onDecoded: (text: string) => void;
  onPermissionDenied?: () => void;
  onStartError?: (error: ScannerError) => void;
}

/**
 * Route Android (and other non-iOS platforms) to the native-
 * `BarcodeDetector` qr-scanner path (`AndroidScanner`). The WASM scanner
 * was tried briefly on Android and observed to hang in the TUA-shell
 * WebView between `getUserMedia` and `loadedmetadata` with no error
 * surfaced — the spinner sits on "Starting camera…" forever. iOS is
 * unaffected by this flag — it has no `BarcodeDetector` QR path exposed
 * to web content and must use WASM. Keep this `false` unless you are
 * actively debugging Android+WASM and have a logging plan: flipping it
 * to `true` will reproduce the hang.
 */

/**
 * Platform picker for the scan surface.
 *
 *   - **iOS** → `WasmScanner` (always). iOS Safari/WKWebView exposes no
 *     native `BarcodeDetector` QR path, so the Worker-hosted ZXing-C++
 *     WASM decoder is the only off-main-thread option.
 *   - **Android / desktop** → `WasmScanner` while `ANDROID_USES_WASM`,
 *     else `AndroidScanner` (stock Nimiq `qr-scanner` + native hardware
 *     `BarcodeDetector`, single start, no retry loop).
 *
 * The platform is resolved ONCE at module load: `isIOS()` reads
 * `navigator.userAgent`, which is stable for the lifetime of a tab, so a
 * runtime flip is impossible without a full reload.
 */
function pickScannerComponent(): ComponentType<ScannerProps> {
  if (isIOS()) return WasmScanner;
  return WasmScanner;
}

const ScannerImpl: ComponentType<ScannerProps> = pickScannerComponent();

export function Scanner(props: ScannerProps) {
  return <ScannerImpl {...props} />;
}

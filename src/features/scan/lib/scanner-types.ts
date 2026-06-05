/**
 * Shared scanner contract — the small surface the two bifurcated flows
 * agree on so the rest of the app never branches on platform.
 *
 * Two fully-separate flows sit underneath, each with its own component
 * and backend; they share this contract and the `camera-stream.ts`
 * primitive, nothing else:
 *
 *   - WASM → `components/WasmScanner.tsx` + `backend-zxing-wasm.ts`.
 *     ZXing-C++ compiled to WASM in a Worker, with a component-level
 *     auto-retry loop. Mandatory on iOS (no native BarcodeDetector QR
 *     path for web content) and the default on Android too.
 *   - Native → `components/AndroidScanner.tsx` + `backend-qr-scanner.ts`.
 *     Bare `<video>` + `getUserMedia` + the browser's native
 *     `BarcodeDetector` (no external scanner library). Single start,
 *     no component-level retry loop. The Android alternative,
 *     selected when `ANDROID_USES_WASM` in `Scanner.tsx` is `false`.
 *
 * The platform dispatch happens once in `components/Scanner.tsx` via
 * `isIOS()` from `@/sdk/host`.
 */

/** Stable error codes the UI branches on (permission vs hardware vs other). */
export type ScannerErrorCode =
  | "cameraUnavailable"
  | "permissionDenied"
  | "startFailed"
  | "scanFailed";

/**
 * Domain error thrown / surfaced by both backends. The raw underlying
 * `DOMException` (when one exists) is preserved on `cause` so logging
 * can show the real failure (`NotReadableError`, `OverconstrainedError`,
 * …) without the UI having to know about WebRTC primitives.
 */
export class ScannerError extends Error {
  constructor(
    public readonly code: ScannerErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ScannerError";
  }
}

/** Caller-provided callbacks. `onError` is best-effort live-scan signal. */
export interface ScannerCallbacks {
  onDecoded(text: string): void;
  onError?(error: ScannerError): void;
}

/** Handle returned by a backend start; `stop()` is idempotent and never throws. */
export interface ScannerHandle {
  stop(): Promise<void>;
}

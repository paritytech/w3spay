/**
 * Camera-based QR scanner wrapping `html5-qrcode`. The host webview unlocks
 * `navigator.mediaDevices.getUserMedia` when the W3SPay manifest declares
 * the `camera` device permission (see `bundle/manifest.toml`); the library
 * does the actual decoding using the OS-native BarcodeDetector when
 * available and a wasm fallback otherwise.
 *
 * The wrapper is deliberately small: start, stop, surface a single
 * decoded-text callback. Lifecycle and error handling stay in `main.ts`.
 */

import { Html5Qrcode } from "html5-qrcode";

/** Caller-provided callbacks. */
export interface ScannerCallbacks {
  onDecoded(text: string): void;
  onError?(error: ScannerError): void;
}

export interface ScannerHandle {
  stop(): Promise<void>;
}

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

export type ScannerErrorCode =
  | "cameraUnavailable"
  | "permissionDenied"
  | "startFailed"
  | "scanFailed";

const SCANNER_ELEMENT_ID = "w3spay-qr-reader";

/**
 * Start the rear-camera scanner inside `host`. The element must be visible
 * (non-zero box) before this is called — html5-qrcode mounts a `<video>`
 * underneath it.
 */
export async function startQrScanner(
  host: HTMLElement,
  callbacks: ScannerCallbacks,
): Promise<ScannerHandle> {
  if (!host.id) host.id = SCANNER_ELEMENT_ID;
  const scanner = new Html5Qrcode(host.id, { verbose: false });
  let decodedOnce = false;
  try {
    await scanner.start(
      { facingMode: { ideal: "environment" } },
      {
        fps: 10,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const min = Math.min(viewfinderWidth, viewfinderHeight);
          const size = Math.floor(min * 0.7);
          return { width: size, height: size };
        },
        aspectRatio: 1,
      },
      (decodedText) => {
        if (decodedOnce) return;
        decodedOnce = true;
        // Cancel further callbacks before delegating; stop() is async and we
        // don't want a second decode firing between this callback and the
        // caller's stop().
        callbacks.onDecoded(decodedText);
      },
      (decodeError) => {
        // html5-qrcode emits these every frame that doesn't decode; surface
        // only at debug level — caller never wants per-frame log spam.
        if (callbacks.onError && /NotAllowedError|NotFoundError|Permission/i.test(decodeError)) {
          callbacks.onError(
            new ScannerError("permissionDenied", decodeError),
          );
        }
      },
    );
  } catch (caught) {
    throw classifyStartError(caught);
  }
  return {
    async stop() {
      try {
        if (scanner.isScanning) await scanner.stop();
      } finally {
        try {
          scanner.clear();
        } catch {
          // ignore — html5-qrcode raises if the element was already torn down.
        }
      }
    },
  };
}

function classifyStartError(caught: unknown): ScannerError {
  const message = caught instanceof Error ? caught.message : String(caught);
  if (/NotAllowedError|Permission/i.test(message)) {
    return new ScannerError("permissionDenied", message, caught);
  }
  if (/NotFoundError|OverconstrainedError/i.test(message)) {
    return new ScannerError("cameraUnavailable", message, caught);
  }
  return new ScannerError("startFailed", message, caught);
}

import { useEffect, useRef, useState } from "react";

import { requestCameraPermission } from "@/shared/api/host";
import { captureError } from "@/telemetry";

import { startQrScannerLibScanner } from "@/features/scan/lib/backend-qr-scanner.ts";
import { isLiveScanHost } from "@/features/scan/lib/scan-host.ts";
import {
  ScannerError,
  type ScannerHandle,
} from "@/features/scan/lib/scanner-types.ts";
import { journeyTracker } from "@/shared/utils/telemetry.ts";
import { Spinner } from "@/shared/components/Spinner.tsx";

export interface AndroidScannerProps {
  onDecoded: (text: string) => void;
  onPermissionDenied?: () => void;
  onStartError?: (error: ScannerError) => void;
}

type Stage =
  | { kind: "askingHost" }
  | { kind: "starting" }
  | { kind: "scanning" };

/**
 * Android (and other non-iOS, e.g. desktop dot.li) scan surface — bare
 * `<video>` + `getUserMedia` + native `BarcodeDetector`
 * (`backend-qr-scanner.ts`). The WASM flow (`WasmScanner.tsx` +
 * `backend-zxing-wasm.ts`) is entirely separate; the two never share
 * lifecycle code.
 *
 * This is the DEFAULT path on Android (and any non-iOS platform).
 * `Scanner.tsx`'s `ANDROID_USES_WASM` flag (default `false`) gates the
 * alternative WASM scanner; that path was tried and observed to hang
 * silently on the Android TUA WebView, so this `BarcodeDetector` flow
 * is what the user actually gets.
 *
 * Deliberately simple: ONE start, no outer auto-retry loop. The
 * post-permission camera-busy window is absorbed by the backend's
 * inline `getUserMedia` back-off (see `acquireRearCamera` in
 * `backend-qr-scanner.ts`), not by remounting the scanner. iOS needs
 * the extra component-level retry because its camera release is async
 * and longer-tailed; Android does not.
 *
 * Two-phase startup:
 *   1. **Host permission gate.** `requestCameraPermission()` flips the
 *      host/iframe `allow="camera"` before we touch `getUserMedia`
 *      (matters for desktop dot.li, which also routes here).
 *   2. **Scanner start.** The backend acquires the camera, attaches it
 *      to a `<video>` it owns, and polls `BarcodeDetector.detect()` at
 *      10 Hz.
 *
 * Ghost guard: a leaving-slot `<ScreenTransition>` copy is `aria-hidden`
 * and must not open a second camera session — `isLiveScanHost` makes it a
 * no-op. See `lib/scan-host.ts`.
 */
export function AndroidScanner({
  onDecoded,
  onPermissionDenied,
  onStartError,
}: AndroidScannerProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: "askingHost" });

  // Latch handlers so the effect's deps stay empty without going stale
  // when the parent passes new functions on each render.
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;
  const onPermissionDeniedRef = useRef(onPermissionDenied);
  onPermissionDeniedRef.current = onPermissionDenied;
  const onStartErrorRef = useRef(onStartError);
  onStartErrorRef.current = onStartError;

  useEffect(() => {
    let cancelled = false;
    let handle: ScannerHandle | null = null;

    void (async () => {
      // Ghost guard FIRST — a leaving-slot transition copy must not open
      // the camera (and must not even trigger a host permission probe).
      const host = elementRef.current;
      if (!isLiveScanHost(host)) return;

      // Phase 1: host permission gate.
      let granted: boolean;
      try {
        granted = await requestCameraPermission();
      } catch (caught) {
        // Defensive — should not throw, but treat as "no host, proceed"
        // so the browser's native getUserMedia prompt can take over.
        console.warn("[w3spay/scanner] camera permission probe failed", caught);
        captureError(caught, { subsystem: "scanner", op: "permission-probe" });
        granted = true;
      }
      if (cancelled) return;

      if (!granted) {
        onPermissionDeniedRef.current?.();
        return;
      }

      // Re-check liveness after the async permission round-trip.
      if (!isLiveScanHost(elementRef.current)) return;

      setStage({ kind: "starting" });

      // Phase 2: single scanner start. The backend pre-warms one
      // MediaStream (riding out the busy window internally) and hands it
      // to qr-scanner — no component-level retry loop.
      try {
        const next = await startQrScannerLibScanner(host, {
          onDecoded: (text) => {
            console.info(`[w3spay/scanner] decoded QR text: ${text}`);
            onDecodedRef.current(text);
          },
          onError: (err) => {
            if (err.code === "permissionDenied") {
              onPermissionDeniedRef.current?.();
            }
          },
        });
        if (cancelled) {
          await next.stop();
          return;
        }
        handle = next;
        journeyTracker.milestone("qr-scan", "scanner-ready");
        setStage({ kind: "scanning" });
      } catch (caught) {
        if (cancelled) return;
        // Log + Sentry-capture the unwrapped error here so a customer-side
        // failure leaves a breadcrumb the dashboard can grep — the error
        // screens erase the raw error from the UI.
        const isScannerErr = caught instanceof ScannerError;
        const code = isScannerErr ? caught.code : "non-scanner-error";
        const cause = isScannerErr ? caught.cause : caught;
        const causeName = cause instanceof Error ? cause.name : "(non-Error)";
        const causeMessage =
          cause instanceof Error ? cause.message : String(cause ?? "");
        console.warn(
          `[w3spay/scanner] startQrScannerLibScanner threw code=${code} cause=${causeName}: ${causeMessage}`,
          caught,
        );
        captureError(caught, {
          subsystem: "scanner",
          op: "start",
          "scanner.error_code": code,
          "scanner.cause_name": causeName,
        });

        if (isScannerErr && caught.code === "permissionDenied") {
          onPermissionDeniedRef.current?.();
          return;
        }
        if (isScannerErr) {
          onStartErrorRef.current?.(caught);
        } else {
          onStartErrorRef.current?.(
            new ScannerError(
              "startFailed",
              caught instanceof Error ? caught.message : String(caught),
              caught,
            ),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      const h = handle;
      handle = null;
      if (!h) return;
      // Cleanup throws unmount the React tree — swallow.
      h.stop().catch((err) => {
        console.warn("[w3spay/scanner] stop() rejected during cleanup", err);
        captureError(err, { subsystem: "scanner", op: "stop-cleanup" });
      });
    };
  }, []);

  return (
    <div className="scanner-wrap">
      <div
        ref={elementRef}
        className="qr-reader"
        aria-label="QR scanner"
      />
      {stage.kind !== "scanning" ? (
        <div className="scanning__overlay" role="status">
          <Spinner
            label={
              stage.kind === "askingHost"
                ? "Asking for camera access…"
                : "Starting camera…"
            }
          />
        </div>
      ) : null}
    </div>
  );
}

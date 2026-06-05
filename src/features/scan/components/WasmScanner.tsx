import { useEffect, useRef, useState } from "react";

import { requestCameraPermission } from "@/shared/api/host";
import { captureError } from "@/telemetry";

import { startZxingWasmScanner } from "@/features/scan/lib/backend-zxing-wasm.ts";
import { isLiveScanHost } from "@/features/scan/lib/scan-host.ts";
import {
  ScannerError,
  type ScannerHandle,
} from "@/features/scan/lib/scanner-types.ts";
import { journeyTracker } from "@/shared/utils/telemetry.ts";
import { Spinner } from "@/shared/components/Spinner.tsx";

export interface WasmScannerProps {
  onDecoded: (text: string) => void;
  onPermissionDenied?: () => void;
  onStartError?: (error: ScannerError) => void;
}

type Stage =
  | { kind: "askingHost" }
  | { kind: "starting" }
  | { kind: "scanning" };

/**
 * WASM scan surface — drives the Worker-hosted ZXing-C++ WASM decoder in
 * `backend-zxing-wasm.ts`. Used on every platform:
 *
 *   - **iOS** — mandatory. iOS Safari/WKWebView does not expose the
 *     native `BarcodeDetector` QR path to web content, so a WASM decoder
 *     in a Worker is the only off-main-thread option.
 *   - **Android / desktop** — opt-in only, via `ANDROID_USES_WASM` in
 *     `Scanner.tsx`. Currently disabled because the WASM start path
 *     hangs silently between `getUserMedia` and `loadedmetadata` on the
 *     TUA Android WebView; the native-`BarcodeDetector` path in
 *     `AndroidScanner.tsx` is the default and is what actually works on
 *     Android.
 *
 * Two-phase startup:
 *
 *   1. **Host permission gate.** Calls `requestCameraPermission()` via
 *      the Polkadot SDK so the host flips `allow="camera"` before we
 *      touch `getUserMedia`.
 *   2. **Scanner start with transparent auto-retry.** The WASM backend
 *      acquires the rear camera, mounts the preview `<video>`, and runs
 *      the decode loop.
 *
 * ### Why the retry loop
 *
 * The camera can be released ASYNCHRONOUSLY after a prior scan unmounts.
 * iOS/WKWebView is the worst offender, but the Android TUA shell's own
 * permission-probe stream races our `getUserMedia` the same way. The
 * inner busy-window back-off in `acquireRearStreamWithRetry` (~1.75 s)
 * covers the typical race; the retries here cover the longer-tail cases
 * where the OS holds the camera for a few extra seconds (typical when
 * scan → confirm → scan-again happens quickly). Without this loop the
 * user lands on the manual "Try again" screen — the exact thing the
 * auto-retry exists to avoid.
 *
 * ### Why the ghost guard
 *
 * `<ScreenTransition>` keeps the leaving screen mounted (`aria-hidden`)
 * for ~280 ms to crossfade out. When the scan screen is leaving, that
 * copy mounts a SECOND scanner whose effect fires and races the live one
 * for the single camera session — the loser rejects with
 * `NotReadableError` and bounces the user to the camera-error screen even
 * though the camera came up fine. `isLiveScanHost` makes the ghost a
 * no-op so only the live surface opens the camera. See `lib/scan-host.ts`.
 *
 * Strict-mode safe: the in-flight start/stop race is resolved with a
 * `cancelled` flag so the dev-only double-mount cycle leaves no camera
 * dangling.
 */
export function WasmScanner({
  onDecoded,
  onPermissionDenied,
  onStartError,
}: WasmScannerProps) {
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
        // Defensive — requestCameraPermission() uses .match() internally
        // and should not throw, but a future SDK revision could. Treat
        // as "no host, proceed" so getUserMedia can surface the browser's
        // native prompt.
        console.warn("[w3spay/scanner] camera permission probe failed", caught);
        captureError(caught, { subsystem: "scanner", op: "permission-probe" });
        granted = true;
      }
      if (cancelled) return;

      if (!granted) {
        onPermissionDeniedRef.current?.();
        return;
      }

      // Re-check liveness after the async permission round-trip: the
      // screen may have started transitioning out while we awaited.
      if (!isLiveScanHost(elementRef.current)) return;

      setStage({ kind: "starting" });

      // Phase 2: scanner start with transparent auto-retry on transient
      // camera-unavailable errors.
      //
      // Each attempt is bounded by the inner retry, so individual hangs
      // stay short (~2s) and `setStage("scanning")` flips the spinner
      // off the moment one attempt succeeds. After
      // `MAX_CAMERA_UNAVAILABLE_RETRIES` we give up and surface the
      // typed error so the user can take action.
      const MAX_CAMERA_UNAVAILABLE_RETRIES = 5;
      const RETRY_DELAY_MS = 800;
      let lastError: ScannerError | null = null;
      for (
        let attempt = 0;
        attempt <= MAX_CAMERA_UNAVAILABLE_RETRIES && !cancelled;
        attempt += 1
      ) {
        try {
          const next = await startZxingWasmScanner(host, {
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
          // Telemetry: camera is now streaming and decoding. Records the
          // time from `scanning` stage entry → first usable viewfinder
          // frame, dominated by host permission grant + getUserMedia
          // warm-up.
          journeyTracker.milestone("qr-scan", "scanner-ready");
          setStage({ kind: "scanning" });
          return;
        } catch (caught) {
          if (cancelled) return;
          // The screens this routes to (`CameraDeniedScreen`,
          // `CameraStartFailedScreen`) erase the raw error from the UI,
          // and `journeyTracker` only records a categorical reason. Log
          // + Sentry-capture the unwrapped error here so a customer-side
          // failure leaves a breadcrumb the dashboard can grep.
          const isScannerErr = caught instanceof ScannerError;
          const code = isScannerErr ? caught.code : "non-scanner-error";
          const cause = isScannerErr ? caught.cause : caught;
          const causeName = cause instanceof Error ? cause.name : "(non-Error)";
          const causeMessage =
            cause instanceof Error ? cause.message : String(cause ?? "");
          console.warn(
            `[w3spay/scanner] startZxingWasmScanner threw on attempt ${attempt + 1} code=${code} cause=${causeName}: ${causeMessage}`,
            caught,
          );
          captureError(caught, {
            subsystem: "scanner",
            op: "start",
            "scanner.attempt": String(attempt + 1),
            "scanner.error_code": code,
            "scanner.cause_name": causeName,
          });

          // Permission denial is terminal — re-prompting won't help.
          if (isScannerErr && caught.code === "permissionDenied") {
            onPermissionDeniedRef.current?.();
            return;
          }

          // `cameraUnavailable` is the OS still holding the camera from
          // the previous scan. Auto-retry — the busy window almost
          // always clears within a few seconds without user action.
          if (
            isScannerErr &&
            caught.code === "cameraUnavailable" &&
            attempt < MAX_CAMERA_UNAVAILABLE_RETRIES
          ) {
            lastError = caught;
            console.info(
              `[w3spay/scanner] cameraUnavailable on attempt ${attempt + 1}; auto-retrying in ${RETRY_DELAY_MS}ms`,
            );
            const wait = Promise.withResolvers<void>();
            window.setTimeout(wait.resolve, RETRY_DELAY_MS);
            await wait.promise;
            if (cancelled) return;
            continue;
          }

          // Any other ScannerError, or cameraUnavailable after exhausting
          // retries — surface to the parent.
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
          return;
        }
      }

      // Loop exit without resolution — only reached if the loop ran out
      // of attempts via the `attempt <= MAX` guard without the body
      // returning. That's the "cameraUnavailable after N retries" path,
      // which already calls `onStartErrorRef` inside the catch — but
      // defend against future edits adding new exit conditions.
      if (!cancelled && lastError != null) {
        onStartErrorRef.current?.(lastError);
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

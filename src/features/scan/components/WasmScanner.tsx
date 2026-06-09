// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import { useEffect, useRef, useState } from "react";

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

type Stage = { kind: "starting" } | { kind: "scanning" };

/**
 * WASM scan surface — drives the Worker-hosted ZXing-C++ decoder in
 * `backend-zxing-wasm.ts`.
 *
 *   - iOS: mandatory. Safari/WKWebView doesn't expose native `BarcodeDetector`
 *     QR to web content, so a WASM decoder in a Worker is the only
 *     off-main-thread option.
 *   - Android/desktop: opt-in via `ANDROID_USES_WASM` in `Scanner.tsx`,
 *     currently disabled — the WASM start hangs silently between `getUserMedia`
 *     and `loadedmetadata` on the TUA WebView; `AndroidScanner.tsx` is default.
 *
 * Single-phase startup: the camera grant is resolved upstream by
 * `useCameraPermission` before mount, so we skip the redundant
 * `requestCameraPermission()` here (it caused the per-receipt extra modal). A
 * real OS-level denial still surfaces via `classifyStartError` →
 * `permissionDenied` → `onPermissionDenied`.
 *
 * Why the retry loop: the camera can be released ASYNCHRONOUSLY after a prior
 * scan unmounts (iOS/WKWebView worst; Android TUA's permission-probe stream
 * races the same way). The inner back-off in `acquireRearStreamWithRetry`
 * (~1.75 s) covers the typical race; these retries cover longer-tail cases
 * (rapid scan → confirm → scan-again). Without it the user lands on the manual
 * "Try again" screen.
 *
 * Ghost guard: `<ScreenTransition>` keeps the leaving screen mounted
 * (`aria-hidden`) ~280 ms to crossfade; that copy mounts a SECOND scanner that
 * races the live one for the single camera session, the loser rejecting with
 * `NotReadableError`. `isLiveScanHost` makes the ghost a no-op. See
 * `lib/scan-host.ts`.
 *
 * Strict-mode safe: the in-flight start/stop race is resolved with a
 * `cancelled` flag so the dev double-mount leaves no camera dangling.
 */
export function WasmScanner({
  onDecoded,
  onPermissionDenied,
  onStartError,
}: WasmScannerProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: "starting" });

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
      // Ghost guard: a leaving-slot transition copy must not open the camera.
      // The grant is resolved upstream; nothing to await before start.
      const host = elementRef.current;
      if (!isLiveScanHost(host)) return;
      // Auto-retry on transient camera-unavailable. Each attempt is bounded by
      // the inner retry (~2s), so a success flips the spinner off promptly;
      // after MAX_CAMERA_UNAVAILABLE_RETRIES we surface the typed error.
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
          // Telemetry: records scanning-stage entry → first usable frame.
          journeyTracker.milestone("w3spay:qr-scan", "scanner-ready");
          setStage({ kind: "scanning" });
          return;
        } catch (caught) {
          if (cancelled) return;
          // The screens this routes to erase the raw error and journeyTracker
          // records only a categorical reason; log + Sentry-capture the
          // unwrapped error here so the dashboard keeps a breadcrumb.
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

          // `cameraUnavailable` = OS still holding the camera from the previous
          // scan; auto-retry, the busy window usually clears within seconds.
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

          // Other ScannerError, or cameraUnavailable after retries exhausted.
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

      // Loop exit without resolution: the catch already calls onStartErrorRef on
      // the exhausted-retries path; this defends against future exit conditions.
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
          <Spinner label="Starting camera…" />
        </div>
      ) : null}
    </div>
  );
}

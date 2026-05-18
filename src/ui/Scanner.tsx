import { useEffect, useRef } from "react";
import {
  ScannerError,
  startQrScanner,
  type ScannerHandle,
} from "../scan/camera.ts";

export interface ScannerProps {
  onDecoded: (text: string) => void;
  onPermissionDenied?: () => void;
  onStartError?: (error: ScannerError) => void;
}

/**
 * Mounts an html5-qrcode rear-camera scanner inside a `<div>` and owns its
 * full lifecycle. Decoded text fires `onDecoded` once per mount — the
 * parent transitions away from the scanning stage, which unmounts this
 * component and triggers the cleanup that stops the MediaStream.
 *
 * Strict-mode safe: the in-flight start/stop race is resolved with a
 * `cancelled` flag so the dev-only double-mount cycle leaves no camera
 * dangling.
 */
export function Scanner({
  onDecoded,
  onPermissionDenied,
  onStartError,
}: ScannerProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  // Latch handlers so the effect's deps stay empty without going stale
  // when the parent passes new functions on each render.
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;
  const onPermissionDeniedRef = useRef(onPermissionDenied);
  onPermissionDeniedRef.current = onPermissionDenied;
  const onStartErrorRef = useRef(onStartError);
  onStartErrorRef.current = onStartError;

  useEffect(() => {
    const host = elementRef.current;
    if (!host) return;

    let cancelled = false;
    let handle: ScannerHandle | null = null;

    void (async () => {
      try {
        const next = await startQrScanner(host, {
          onDecoded: (text) => onDecodedRef.current(text),
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
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ScannerError) {
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
      if (h) void h.stop();
    };
  }, []);

  return (
    <div
      ref={elementRef}
      id="w3spay-qr-reader"
      className="qr-reader"
      aria-label="QR scanner"
    />
  );
}

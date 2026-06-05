/**
 * Rear-camera acquisition primitive — shared by both scanner backends.
 *
 * This is intentionally NOT a scanner: it owns no `<video>`, no decode
 * loop, no React lifecycle. It is the one place that talks to
 * `navigator.mediaDevices.getUserMedia`, cascades through realistic
 * mobile resolution tiers, rides out the post-`track.stop()` busy window,
 * and classifies the raw `DOMException` shapes into stable `ScannerError`
 * codes.
 *
 * The iOS (`backend-zxing-wasm.ts`) and Android (`backend-qr-scanner.ts`)
 * flows are otherwise fully separate — different decoders, different
 * lifecycles, different retry strategies. They share THIS module only
 * because "open the rear camera at the most pixels the device will give
 * us, and tell the caller *why* it failed" is a hardware concern with one
 * correct answer on both platforms; duplicating it would let the two
 * copies drift on the subtle parts (the transient-error back-off, the
 * fail-fast classification) that took device testing to get right.
 */

import { ScannerError } from "@/features/scan/lib/scanner-types.ts";

/**
 * Result of a pre-warm attempt.
 *
 * On success the caller binds the stream to its `<video>`. On failure
 * the caller looks at `error` to decide whether to surface a typed error
 * immediately (terminal causes like denied permission) or fall back to a
 * library's built-in acquisition (recoverable / unknown causes — see
 * `shouldFailFast`).
 *
 * Tracking the last error is the point of this type: a library's own
 * acquisition (e.g. qr-scanner's `_getCameraStream`) swallows every
 * getUserMedia rejection and re-throws a flat `"Camera not found."`
 * string, which obliterates the difference between "user denied
 * permission" and "no camera on this device" and ends up routing both to
 * the same UI screen.
 */
export type AcquireResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; error: Error | null };

/**
 * Ask the browser for the rear camera with no resolution constraints.
 *
 * Just `facingMode: "environment"` — let the WebView/browser pick
 * whatever resolution and frame rate the device wants to give us.
 *
 * We previously cascaded through 1080p → 720p → bare in case a device
 * choked on a high `ideal` width, but in practice the tier list caused
 * more problems than it solved on the Android TUA WebView: tiers
 * rejected for reasons our loop couldn't always recover from, and the
 * "more source pixels" promise was illusory anyway — the decoder
 * downscales to `DECODE_CANVAS_CAP=2048` after the central-square crop,
 * so anything above ~2K source resolution is binned before it reaches
 * ZXing or BarcodeDetector. The bare request is the one every device
 * supports.
 *
 * Returns the live stream or the raw `getUserMedia` error so the caller
 * can classify it (permission denied → typed error, transient
 * busy-window → retry, anything else → fall through).
 *
 * @internal exported for testing — see camera-stream.test.ts
 */
export async function acquireRearStream(): Promise<AcquireResult> {
  if (typeof navigator === "undefined" || navigator.mediaDevices?.getUserMedia == null) {
    return {
      ok: false,
      error: new Error("getUserMedia is not available in this runtime"),
    };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "environment" },
    });
    return { ok: true, stream };
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    console.warn(`[w3spay/scanner] getUserMedia rejected: ${error.name}: ${error.message}`);
    return { ok: false, error };
  }
}

/**
 * Camera errors that mean "try again in a moment", not "give up".
 *
 * iOS / WKWebView releases the camera ASYNCHRONOUSLY after `track.stop()`.
 * Older Android Chrome WebViews behave similarly when the host has just
 * relinquished a stream (e.g. TUA's own permission-validation probe).
 * A `getUserMedia` issued before that teardown completes rejects with
 * `NotReadableError` ("Could not start video source") — older WebKit
 * spells the same condition `AbortError`. This is the "comes back for a
 * moment, then fails again" loop users hit on retry: the camera IS
 * available, we just asked a beat too early.
 *
 * @internal exported for testing — see camera-stream.test.ts
 */
export function isTransientCameraError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "NotReadableError" || error.name === "AbortError")
  );
}

/**
 * Back-off schedule (ms) for riding out the post-stop busy window.
 *
 * Kept short on purpose — the iOS scanner component retries
 * `cameraUnavailable` itself, so the inner budget only needs to cover
 * the typical iOS WKWebView async-release race (a few hundred ms after
 * `track.stop()`). Stretching it to multiple seconds made the user
 * stare at a frozen "Starting camera…" spinner.
 */
const CAMERA_BUSY_RETRY_DELAYS_MS = [250, 500, 1000] as const;

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * `acquireRearStream` wrapped in a transient-retry back-off.
 *
 * On Android TUA the host's `handleDevicePermission("Camera")` opens a
 * brief validation stream before returning `true`; the release of that
 * stream races our `getUserMedia` and the latter rejects with
 * `NotReadableError`. On iOS WKWebView the same race shows up after a
 * scanner remount (the previous stream's `track.stop()` settles
 * asynchronously). We ride it out with a short exponential-ish back-off
 * and re-acquire.
 *
 * We deliberately open exactly ONE `MediaStream` per attempt and never
 * a second overlapping `getUserMedia`. Opening a second stream to
 * "upgrade" lenses while the first is live wedges the camera on iOS
 * into a `NotReadableError` that only a full reload clears — the
 * "Couldn't open the camera" loop. We take whatever lens
 * `facingMode: environment` resolves to.
 *
 * Non-transient failures (permission denied, no camera) return
 * immediately so the permission UI isn't delayed.
 *
 * @internal exported for testing — see camera-stream.test.ts
 */
export async function acquireRearStreamWithRetry(): Promise<AcquireResult> {
  let result = await acquireRearStream();
  for (const backoffMs of CAMERA_BUSY_RETRY_DELAYS_MS) {
    if (
      result.ok ||
      result.error == null ||
      !isTransientCameraError(result.error)
    ) {
      return result;
    }
    console.warn(
      `[w3spay/scanner] transient camera error; backing off ${backoffMs}ms`,
    );
    await delay(backoffMs);
    result = await acquireRearStream();
  }
  return result;
}

/**
 * `true` when a pre-warm error is terminal enough that we should not
 * hand off to a library's own getUserMedia fallback. Those cases
 * (denied permission, missing camera, missing API) won't recover by
 * trying the same constraints a second time — the library would just
 * lose our error context and throw "Camera not found." instead.
 *
 * Anything we don't recognise falls through to the library fallback so a
 * weird device-specific failure still gets the second chance the
 * library's relaxing cascade offers.
 *
 * @internal exported for testing — see camera-stream.test.ts
 */
export function shouldFailFast(error: Error): boolean {
  if (error.name === "NotAllowedError") return true;
  if (error.name === "NotFoundError") return true;
  if (error.name === "SecurityError") return true;
  if (/getUserMedia is not available/i.test(error.message)) return true;
  return false;
}

/** Stop every track on `stream`, swallowing per-track teardown errors. */
export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Map a raw camera-acquisition error onto a stable `ScannerError` code so
 * the UI can branch on intent (permission denied vs no camera vs generic
 * failure) without inspecting the raw message.
 *
 * Both shapes are handled: a `DOMException` (when `getUserMedia` fails:
 * NotAllowedError, NotFoundError, OverconstrainedError, NotReadableError)
 * and the flat string a library re-throws when its own constraint-relaxing
 * fallback is exhausted (`"Camera not found."`).
 *
 * @internal exported for testing — see camera-stream.test.ts
 */
export function classifyStartError(caught: unknown): ScannerError {
  if (caught instanceof ScannerError) return caught;
  if (caught instanceof Error && caught.name === "NotAllowedError") {
    return new ScannerError("permissionDenied", caught.message, caught);
  }
  if (
    caught instanceof Error &&
    (caught.name === "NotFoundError" ||
      caught.name === "OverconstrainedError" ||
      caught.name === "NotReadableError")
  ) {
    return new ScannerError("cameraUnavailable", caught.message, caught);
  }
  const message = caught instanceof Error ? caught.message : String(caught);
  if (/NotAllowedError|Permission/i.test(message)) {
    return new ScannerError("permissionDenied", message, caught);
  }
  if (/NotFoundError|OverconstrainedError|Camera not found/i.test(message)) {
    return new ScannerError("cameraUnavailable", message, caught);
  }
  return new ScannerError("startFailed", message, caught);
}

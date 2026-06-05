/**
 * Host permission React surface.
 *
 * `useCameraPermission` probes the host's camera-permission grant once at
 * mount and exposes a stable `state` plus a `retry()` for "camera needed"
 * screens. Moved here from the w3spay app so any product that scans
 * inside a Polkadot host shares one implementation.
 *
 * Why probe at boot (rather than lazily inside the scanner):
 *   - On dot.li the iframe's `allow="camera"` attribute is only set after
 *     the user accepts the host modal. Probing at boot fires the modal
 *     before the scanning chrome ever renders, so a previously-denied
 *     grant never produces a "scanning UI → bounce to needs-camera" flash.
 *   - It centralises permission state in one hook the routing layer can
 *     branch on declaratively.
 *
 * Sequencing: dot.li shows only one host permission modal at a time, so
 * the caller passes `enabled` to defer the probe until prior modals (e.g.
 * a balance modal) have closed. While `enabled === false` the state stays
 * `pending`.
 * Host-readiness gate: the probe also waits for `useHostWalletSnapshot().isReady`
 * — the camera modal must not fire before the auto-initing store's
 * handshake completes.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { requestCameraPermission } from "./connection.ts";
import { useHostWalletSnapshot } from "./wallet.ts";

export type CameraPermissionOutcome =
  /** Iframe `allow="camera"` is set; safe to call getUserMedia. */
  | { kind: "granted" }
  /** User explicitly denied (or dot.li is about to reload the iframe). */
  | { kind: "denied" };

export type CameraPermissionState =
  | { kind: "pending" }
  | { kind: "host-unavailable" }
  | CameraPermissionOutcome;

export interface UseCameraPermissionResult {
  readonly state: CameraPermissionState;
  /**
   * Re-probe the host. Idempotent and safe to call concurrently — the
   * second concurrent call is dropped. After the SDK has cached a
   * grant/denial this returns near-instantly without re-prompting.
   */
  retry(): Promise<void>;
}

export interface UseCameraPermissionOptions {
  /**
   * Defer the probe until prior host modals have settled. Set this to the
   * resolution of any earlier permission modal so the camera modal doesn't
   * race it — dot.li would silently drop the second one.
   */
  enabled: boolean;
}

/** Decision the gate hands back to the hook. `probe` means "ask the host". */
export type CameraGateDecision =
  | { kind: "pending" }
  | { kind: "granted" }
  | { kind: "host-unavailable" }
  | { kind: "probe" };

/**
 * Pure gate for the camera-permission probe. Extracted from the effect so
 * the transition table is testable without React or a host bridge:
 *
 *  - `enabled === false`  → `pending` (caller is still deferring)
 *  - outside a host       → `granted` (browser getUserMedia owns the prompt)
 *  - host not ready        → `host-unavailable` (don't race a dead port)
 *  - otherwise             → `probe` (ask the host)
 *
 * The `enabled` gate is dropped on the retry path (the user explicitly
 * asked) by passing `enabled: true`.
 */
export function cameraPermissionGate(input: {
  enabled: boolean;
  isOutsideHost: boolean;
  isReady: boolean;
}): CameraGateDecision {
  if (!input.enabled) return { kind: "pending" };
  if (input.isOutsideHost) return { kind: "granted" };
  if (!input.isReady) return { kind: "host-unavailable" };
  return { kind: "probe" };
}

/** Result of `exerciseCamera`. */
export type CameraExerciseResult =
  | { kind: "ok" }
  | { kind: "failed"; reason: CameraExerciseFailureReason };

/**
 * Why the OS-level exercise didn't open the camera. The hook uses
 * this only to decide between `denied` vs an opaque
 * `host-unavailable` — the dapp's scanner backend handles its own
 * detailed classification when it re-acquires the camera for real.
 */
export type CameraExerciseFailureReason =
  /** `NotAllowedError`. OS-level permission has been revoked or never granted. */
  | "denied"
  /** `NotReadable`/`NotFound`/`OverconstrainedError` — camera held or absent. */
  | "unavailable"
  /** `getUserMedia` is missing in this runtime (SSR / non-browser test). */
  | "no-runtime";

/**
 * Briefly open the rear camera and immediately release it, returning
 * whether the OS-level grant is actually live.
 *
 * Why: `requestCameraPermission()` reports what the *host* knows. On
 * the TUA Android shell that answer is cached — once the user clicks
 * through the host modal it returns `true` for the rest of the page
 * session. But Android's "Only this time" grant on the native popup
 * is single-use: it dies as soon as the camera closes. Next time the
 * dapp acquires the camera, the host says "granted" but `getUserMedia`
 * fails (typically `NotReadableError`) and the scanner spinner sits
 * forever.
 *
 * The exercise is a truth probe: open the camera, immediately stop
 * every track, report what happened. The brief acquire/release leaves
 * a few-hundred-ms busy window before the scanner re-acquires for
 * real — that's what the scanner backend's own busy retry exists to
 * absorb.
 */
export async function exerciseCamera(): Promise<CameraExerciseResult> {
  if (
    typeof navigator === "undefined" ||
    navigator.mediaDevices?.getUserMedia == null
  ) {
    return { kind: "failed", reason: "no-runtime" };
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "environment" },
    });
  } catch (caught) {
    const name = caught instanceof Error ? caught.name : "";
    if (name === "NotAllowedError") {
      return { kind: "failed", reason: "denied" };
    }
    // NotReadableError, NotFoundError, OverconstrainedError,
    // AbortError — camera can't be opened right now. Surface as
    // unavailable so the UI prompts the user (e.g. reload to re-grant
    // after "Only this time" expired) rather than silently routing to
    // the scanner where getUserMedia will fail again.
    return { kind: "failed", reason: "unavailable" };
  }
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Per-track teardown errors don't matter for the truth probe.
    }
  }
  return { kind: "ok" };
}

export function useCameraPermission(
  options: UseCameraPermissionOptions,
): UseCameraPermissionResult {
  const { enabled } = options;
  const [state, setState] = useState<CameraPermissionState>({ kind: "pending" });
  const inFlightRef = useRef(false);
  const wallet = useHostWalletSnapshot();

  const probe = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      // Retry path drops the `enabled` gate — the user explicitly asked.
      const decision = cameraPermissionGate({
        enabled: true,
        isOutsideHost: wallet.isOutsideHost,
        isReady: wallet.isReady,
      });
      if (decision.kind !== "probe") {
        // `pending` can't surface here (enabled is forced true), so this is
        // either `granted` (outside host) or `host-unavailable` (not ready).
        setState(decision);
        return;
      }
      let granted: boolean;
      try {
        granted = await requestCameraPermission();
      } catch (caught) {
        // Defensive — `requestCameraPermission()` uses `.match()`
        // internally and should not throw, but a future SDK revision
        // could. Treat as "no host, proceed" so the browser's native
        // getUserMedia prompt can take over.
        console.warn("[sdk/camera-permission] probe threw", caught);
        granted = true;
      }
      if (!granted) {
        setState({ kind: "denied" });
        return;
      }
      // Verify the OS-level grant matches what the host reported.
      // `requestCameraPermission()` can return `true` from cache while
      // Android has revoked the actual grant (e.g. user picked "Only
      // this time" on the native prompt and the camera has since
      // closed). The exercise opens the camera briefly and reports
      // the truth.
      const exercise = await exerciseCamera();
      if (exercise.kind === "ok" || exercise.reason === "no-runtime") {
        // `no-runtime` only happens in SSR / unit tests where there's
        // no `navigator.mediaDevices`; trust the host's grant in that
        // case since there's nothing to verify against.
        setState({ kind: "granted" });
        return;
      }
      console.warn(
        `[sdk/camera-permission] host reported granted but exercise failed (${exercise.reason}); reporting denied`,
      );
      setState({ kind: "denied" });
    } finally {
      inFlightRef.current = false;
    }
  }, [wallet.isOutsideHost, wallet.isReady]);

  useEffect(() => {
    const decision = cameraPermissionGate({
      enabled,
      isOutsideHost: wallet.isOutsideHost,
      isReady: wallet.isReady,
    });
    if (decision.kind === "probe") {
      void probe();
      return;
    }
    // `pending` while still deferring keeps the initial state; the
    // terminal `granted` / `host-unavailable` decisions are set directly.
    if (decision.kind !== "pending") {
      setState(decision);
    }
  }, [enabled, wallet.isOutsideHost, wallet.isReady, probe]);

  return { state, retry: probe };
}

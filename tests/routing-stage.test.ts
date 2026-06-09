/**
 * Tests for the pure routing function
 * `computeRoutingStage(auth, camera, hostStatus)`.
 *
 * Locks the boot-time permission gates so:
 *   - The boot screen is held until auth and the host bridge are terminal.
 *     Camera is NOT a boot gate — the probe runs on the scan page so the
 *     iOS native sheet can't race the host's permission modal.
 *   - A previously-denied camera grant lands the user on `needsCamera`
 *     immediately via the root gate (no scan page mount needed).
 *   - `pending` / `host-unavailable` camera states pass through to
 *     `scanning`; the scan page withholds the scanner until `granted`.
 *   - host-bridge timeout on a connected session surfaces
 *     `hostUnavailable` up-front rather than letting the user reach
 *     `confirm` with a silently-disabled Pay button.
 */

import { describe, expect, it } from "vitest";

import {
  NEEDS_CAMERA_MESSAGE,
  computeRoutingStage,
} from "@/features/payment/lib/stage.ts";
import type { HostAuthState } from "@/features/host/api/host-auth.ts";
import type { CameraPermissionState } from "@/shared/api/host";
import type { CoinPaymentHostStatus } from "@/features/host/api/coin-payment-host.ts";

const connected: HostAuthState = { kind: "connected" };

function camera(kind: CameraPermissionState["kind"]): CameraPermissionState {
  return { kind } as CameraPermissionState;
}

const ready: CoinPaymentHostStatus = "ready";

describe("computeRoutingStage", () => {
  it("stays on boot while auth is pending regardless of camera or host state", () => {
    expect(computeRoutingStage({ kind: "pending" }, camera("granted"), ready)).toEqual({
      kind: "boot",
    });
    expect(computeRoutingStage({ kind: "pending" }, camera("denied"), "timeout")).toEqual({
      kind: "boot",
    });
  });

  it("routes outsideHost to hostUnavailable", () => {
    expect(computeRoutingStage({ kind: "outsideHost" }, camera("granted"), ready)).toMatchObject({
      kind: "hostUnavailable",
    });
  });

  it("surfaces the handshake-failure reason verbatim on hostUnavailable", () => {
    // useHostAuth sets a specific "host did not respond" reason on
    // handshake failure. The routing layer must propagate it so the
    // user knows to reload, instead of showing the generic "open
    // through your Polkadot app" copy that tells them nothing.
    const reason = "The Polkadot host did not respond. Make sure you opened this app from the host, then reload.";
    const stage = computeRoutingStage(
      { kind: "error", reason },
      camera("granted"),
      ready,
    );
    expect(stage).toEqual({ kind: "hostUnavailable", message: reason });
  });

  it("falls back to the generic copy when the error has no reason", () => {
    const stage = computeRoutingStage(
      { kind: "error", reason: "" },
      camera("granted"),
      ready,
    );
    expect(stage).toMatchObject({
      kind: "hostUnavailable",
      message: "Open W3S Receipts through your Polkadot app to keep going.",
    });
  });

  it("routes disconnected to needsLogin", () => {
    expect(computeRoutingStage({ kind: "disconnected" }, camera("granted"), ready)).toEqual({
      kind: "needsLogin",
    });
  });

  describe("auth.connected", () => {
    it("passes through to scanning while the camera probe is pending (probe fires on scan page)", () => {
      // `pending` = probe not yet started. The scan page fires
      // `useCameraPermission` on mount; until it resolves the scanner
      // itself is gated by `permissionsReady` on the scan page.
      expect(computeRoutingStage(connected, camera("pending"), ready)).toEqual({
        kind: "scanning",
      });
    });

    it("passes through to scanning while the host-unavailable probe is in flight", () => {
      // `host-unavailable` = probe fired but not yet resolved. The scan
      // page gates the scanner on `camera.kind === "granted"` so the
      // video element is never mounted during this window.
      expect(computeRoutingStage(connected, camera("host-unavailable"), ready)).toEqual({
        kind: "scanning",
      });
    });

    it("lands on needsCamera with the canonical message when previously denied", () => {
      expect(computeRoutingStage(connected, camera("denied"), ready)).toEqual({
        kind: "needsCamera",
        message: NEEDS_CAMERA_MESSAGE,
      });
    });

    it("surfaces hostUnavailable when the bridge poll timed out, even with granted camera", () => {
      // The Pay button is gated on `if (host)`; without this branch the
      // customer would reach `confirm` and watch the button stay
      // silently disabled.
      expect(computeRoutingStage(connected, camera("granted"), "timeout")).toMatchObject({
        kind: "hostUnavailable",
      });
    });

    it("holds boot while the host bridge is still resolving", () => {
      expect(computeRoutingStage(connected, camera("granted"), "pending")).toEqual({
        kind: "boot",
      });
    });

    it("routes to scanning once auth and the bridge are terminal", () => {
      expect(computeRoutingStage(connected, camera("granted"), ready)).toEqual({
        kind: "scanning",
      });
    });
  });
});

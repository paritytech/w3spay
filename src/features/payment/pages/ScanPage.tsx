/**
 * Index page — the live scan surface.
 *
 * Two visible states:
 *   - `session.resolving` → boot splash while the scan flow resolves a
 *     decoded TSE (idempotency + merchant lookup). Camera is torn down.
 *   - otherwise           → `<ScanningScreen>` mounted with live host
 *     state and the scan-grace timer running.
 *
 * **Camera permission** is probed here, not at boot. Deferring to this
 * page means the iOS native camera sheet only appears after the balance
 * (payment-permission) modal has fully closed — no more modal collision.
 * The probe is gated on `balancePermissionResolved` so it can't race the
 * payment modal. Scanner start is additionally gated on `cameraGranted`
 * so the `<video>` element is never mounted before iOS says yes.
 *
 * The scan-grace lifecycle (open the qr-scan journey on entry, flush the
 * captured bad-scan on timeout, abandon the journey on unmount) lives in
 * `<ScanningView>` so the effect's lifecycle aligns with when the camera
 * is actually visible.
 */

import { useEffect } from "react";

import { useNavigate } from "@tanstack/react-router";
import { useCameraPermission } from "@/shared/api/host";

import { PATHS } from "@/app/router/routes.ts";
import { UNSUPPORTED_SCAN_GRACE_MS } from "@/features/payment/lib/stage.ts";
import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { useSessionStore } from "@/features/payment/store/session-store.ts";
import { ScanningScreen } from "@/features/payment/components/ScanningScreen.tsx";
import { useCameraStore } from "@/features/scan/store/camera-store.ts";
import { usePaymentBalanceDerived } from "@/features/host/api/balance.ts";
import { BootScreen } from "@/features/host/components/BootScreen.tsx";
import { journeyTracker } from "@/shared/utils/telemetry.ts";

export function ScanPage() {
  const resolving = useSessionStore((s) => s.resolving);
  return resolving ? <BootScreen /> : <ScanningView />;
}

function ScanningView() {
  const actions = usePaymentActions();
  const navigate = useNavigate();
  const { availableCents, balancePermissionResolved } = usePaymentBalanceDerived();

  // Camera probe — runs only when we're on the scan page and balance has
  // resolved. This is the single call site for `useCameraPermission`; the
  // result is published to `useCameraStore` so the root gate and the
  // CameraDenied screen can both read it.
  const cameraPermission = useCameraPermission({ enabled: balancePermissionResolved });
  const publishCamera = useCameraStore((s) => s.publish);
  const retry = useCameraStore((s) => s.retry);
  useEffect(() => {
    publishCamera({ state: cameraPermission.state, retry: cameraPermission.retry });
  }, [cameraPermission.state, cameraPermission.retry, publishCamera]);

  // Gate the scanner on camera being explicitly granted. `pending` and
  // `host-unavailable` mean the probe hasn't resolved yet; starting the
  // scanner early would call getUserMedia before the grant is confirmed.
  const cameraGranted = cameraPermission.state.kind === "granted";

  // Scan-grace lifecycle: open the qr-scan journey on entry, surface the
  // right fallback if no valid TSE lands within the grace window, and
  // abandon the journey if we leave for any other reason.
  useEffect(() => {
    useSessionStore.getState().setLastBadScan(null);
    journeyTracker.start("qr-scan");
    const timeoutId = window.setTimeout(
      () => actions.flushScanGrace(),
      UNSUPPORTED_SCAN_GRACE_MS,
    );
    return () => {
      window.clearTimeout(timeoutId);
      if (journeyTracker.isActive("qr-scan")) {
        journeyTracker.fail("qr-scan", "abandoned");
      }
    };
  }, [actions]);

  return (
    <ScanningScreen
      onDecoded={actions.handleDecoded}
      onPermissionDenied={() => void retry()}
      onScannerStartError={(error) =>
        actions.goToStage({ kind: "cameraError", message: error.message })
      }
      onOpenWallet={() => void navigate({ to: PATHS.wallet, search: { tab: "activity" } })}
      availableCents={availableCents}
      permissionsReady={balancePermissionResolved && cameraGranted}
    />
  );
}

/**
 * Router root — the app shell + host gate.
 *
 * `AppShell` is the root route's component: it mounts the always-on
 * chrome (banners, dev-pay launcher, the invisible `<HostBridge>`) and
 * then either renders a host-derived *gate* screen or the matched route
 * via `<Outlet/>`.
 *
 * The gate reuses the pure `computeRoutingStage(auth, camera, hostStatus)`
 * — the same function the old stage machine used — so the boot /
 * sign-in / host-unavailable / needs-camera decisions (and their tests)
 * are unchanged. Only the *mechanism* differs: instead of clobbering a
 * stage, the gate withholds `<Outlet/>` while a gate condition holds. The
 * flow routes are never gated mid-flight — they live behind `scanning`,
 * the single "ready" gate result — so a transient auth blip can't yank a
 * customer off `confirm`.
 *
 * The `<ScreenTransition>` crossfade is preserved, keyed on the gate kind
 * while gated and on the route location once interactive.
 */

import { useEffect, useRef, type ReactNode } from "react";

import { createRootRoute, Outlet, useLocation } from "@tanstack/react-router";

import { computeRoutingStage } from "@/features/payment/lib/stage.ts";
import { DummyBalanceBanner } from "@/features/host/components/DummyBalanceBanner.tsx";
import { StaleMerchantsBanner } from "@/features/merchants/components/StaleMerchantsBanner.tsx";
import { DevPayLauncher } from "@/features/payment/components/DevPayLauncher.tsx";
import { HostBridge } from "@/app/host-bridge.tsx";
import { useCameraStore } from "@/features/scan/store/camera-store.ts";
import { useCoinPaymentHost } from "@/features/host/api/coin-payment-host.ts";
import { useHostAuth } from "@/features/host/api/host-auth.ts";
import { usePaymentBalanceDerived } from "@/features/host/api/balance.ts";
import { useSessionStore } from "@/features/payment/store/session-store.ts";
import { journeyTracker } from "@/shared/utils/telemetry.ts";
import { BootScreen } from "@/features/host/components/BootScreen.tsx";
import { CameraDeniedScreen } from "@/features/host/components/CameraDeniedScreen.tsx";
import { HostUnavailableScreen } from "@/features/host/components/HostUnavailableScreen.tsx";
import { SignInScreen } from "@/features/host/components/SignInScreen.tsx";
import { BootErrorScreen } from "@/features/host/components/BootErrorScreen.tsx";
import { ScreenTransition } from "@/shared/components/ScreenTransition.tsx";
import { UnsupportedPlatformScreen } from "@/features/host/components/UnsupportedPlatformScreen.tsx";
import { envConfig, detectPlatform } from "@/shared/config.ts";

/**
 * Current platform, detected once at module load — synchronous and stable
 * for the page lifetime. Compared against `envConfig.features.supportedPlatforms`
 * to decide whether to gate the app before any host hooks run.
 */
const CURRENT_PLATFORM = detectPlatform();

function AppShell() {
  const { state: authState } = useHostAuth();
  const { status: hostStatus } = useCoinPaymentHost();
  const cameraState = useCameraStore((s) => s.state);
  const cameraRetry = useCameraStore((s) => s.retry);
  const { state: balanceState, balancePermissionResolved, refresh: refreshBalance } =
    usePaymentBalanceDerived();

  const gate = computeRoutingStage(authState, cameraState, hostStatus, balancePermissionResolved);
  const location = useLocation();

  // App-boot journey closes the moment routing leaves the boot screen.
  // `boot.first_stage` records which interactive screen we landed on.
  const wasBootRef = useRef(true);
  useEffect(() => {
    if (
      gate.kind !== "boot" &&
      wasBootRef.current &&
      journeyTracker.isActive("app-boot")
    ) {
      journeyTracker.complete("app-boot", { "boot.first_stage": gate.kind });
    }
    if (gate.kind !== "boot") wasBootRef.current = false;
  }, [gate.kind]);

  let body: ReactNode;
  switch (gate.kind) {
    case "boot":
      body = <BootScreen />;
      break;
    case "needsCamera":
      body = (
        <CameraDeniedScreen onRetry={() => void cameraRetry()} message={gate.message} />
      );
      break;
    case "needsLogin":
      body = <SignInScreen />;
      break;
    case "hostUnavailable":
      body = <HostUnavailableScreen message={gate.message} />;
      break;
    default: {
      // `scanning` — ready. Hand off to the matched route, UNLESS the
      // balance fetch failed, in which case surface the retry screen.
      // We only interrupt the scan surface (flow === null) — a customer
      // who is mid-payment should not be yanked off the confirm screen.
      const isBalanceError =
        balanceState.kind === "error" && useSessionStore.getState().flow === null;
      body = isBalanceError ? (
        <BootErrorScreen message={balanceState.reason} onRetry={refreshBalance} />
      ) : (
        <Outlet />
      );
    }
  }

  const isBalanceErrorGate =
    gate.kind === "scanning" &&
    balanceState.kind === "error" &&
    useSessionStore.getState().flow === null;

  const transitionKey = isBalanceErrorGate
    ? "gate:balanceError"
    : gate.kind === "scanning"
      ? `route:${location.pathname}`
      : `gate:${gate.kind}`;

  return (
    <section className="workspace">
      <StaleMerchantsBanner />
      <DummyBalanceBanner />
      <DevPayLauncher />
      <HostBridge />
      <ScreenTransition transitionKey={transitionKey}>{body}</ScreenTransition>
    </section>
  );
}

/**
 * Guard wrapper: checks `envConfig.features.supportedPlatforms` before
 * mounting any host hooks, auth queries, or camera state. Unsupported
 * platforms (desktop browser, dot.li, …) get a static gate screen;
 * the host bridge and all subscriptions remain completely uninitialised.
 */
function AppShellGuard() {
  if (!envConfig.features.supportedPlatforms.includes(CURRENT_PLATFORM)) {
    return (
      <section className="workspace">
        <UnsupportedPlatformScreen />
      </section>
    );
  }
  return <AppShell />;
}

export const rootRoute = createRootRoute({ component: AppShellGuard });

// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Router root — app shell + host gate. `AppShell` mounts the always-on chrome
 * (banners, dev-pay launcher, the invisible `<HostBridge>`) and then renders a
 * host-derived gate screen or the matched route via `<Outlet/>`.
 *
 * The gate withholds `<Outlet/>` while a gate condition holds (via pure
 * `computeRoutingStage`) rather than clobbering a stage. Flow routes are never
 * gated mid-flight — they live behind the single "ready" result `scanning` —
 * so a transient auth blip can't yank a customer off `confirm`.
 * `<ScreenTransition>` is keyed on the gate kind while gated, on the route
 * location once interactive.
 */

import { useEffect, useRef, type ReactNode } from "react";

import { createRootRoute, Outlet, useLocation } from "@tanstack/react-router";

import { computeRoutingStage } from "@/features/payment/lib/stage.ts";
import { StaleMerchantsBanner } from "@/features/merchants/components/StaleMerchantsBanner.tsx";
import { DevPayLauncher } from "@/features/payment/components/DevPayLauncher.tsx";
import { HostBridge } from "@/app/host-bridge.tsx";
import { useCameraStore } from "@/features/scan/store/camera-store.ts";
import { useCoinPaymentHost } from "@/features/host/api/coin-payment-host.ts";
import { useHostAuth } from "@/features/host/api/host-auth.ts";
import { journeyTracker } from "@/shared/utils/telemetry.ts";
import { BootScreen } from "@/features/host/components/BootScreen.tsx";
import { CameraDeniedScreen } from "@/features/host/components/CameraDeniedScreen.tsx";
import { HostUnavailableScreen } from "@/features/host/components/HostUnavailableScreen.tsx";
import { SignInScreen } from "@/features/host/components/SignInScreen.tsx";
import { ScreenTransition } from "@/shared/components/ScreenTransition.tsx";
import { UnsupportedPlatformScreen } from "@/features/host/components/UnsupportedPlatformScreen.tsx";
import { envConfig } from "@/config";
import { detectPlatform } from "@/shared/api/host/platform";

/**
 * Current platform, detected once at module load. Compared against
 * `envConfig.features.supportedPlatforms` to gate the app before any host hooks run.
 */
const CURRENT_PLATFORM = detectPlatform();

function AppShell() {
  const { state: authState } = useHostAuth();
  const { status: hostStatus } = useCoinPaymentHost();
  const cameraState = useCameraStore((s) => s.state);
  const cameraRetry = useCameraStore((s) => s.retry);

  const gate = computeRoutingStage(authState, cameraState, hostStatus);
  const location = useLocation();

  // app-boot journey closes once routing leaves the boot screen;
  // `boot.first_stage` records which interactive screen we landed on.
  const wasBootRef = useRef(true);
  useEffect(() => {
    if (
      gate.kind !== "boot" &&
      wasBootRef.current &&
      journeyTracker.isActive("w3spay:app-boot")
    ) {
      journeyTracker.complete("w3spay:app-boot", { "boot.first_stage": gate.kind });
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
    default:
      // `scanning` — ready. Hand off to the matched route.
      body = <Outlet />;
  }

  const transitionKey =
    gate.kind === "scanning"
      ? `route:${location.pathname}`
      : `gate:${gate.kind}`;

  return (
    <section className="workspace">
      <StaleMerchantsBanner />
      <DevPayLauncher />
      <HostBridge />
      <ScreenTransition transitionKey={transitionKey}>{body}</ScreenTransition>
    </section>
  );
}

/**
 * Guard wrapper: gates unsupported platforms (desktop browser, dot.li, …) to a
 * static screen before any host hooks, auth queries, or camera state mount.
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

/**
 * Invisible side-effect owner for host-derived state.
 *
 * Mounted once under the router root. Centralises the two things that
 * MUST run exactly once and be shared app-wide:
 *
 *   1. **App-boot telemetry** — opens the `app-boot` journey and records a
 *      milestone as each upstream host signal resolves. Completed by
 *      `<AppShell>` when routing leaves the boot screen.
 *   2. **Dev-standalone console hooks** — binds `window.__w3spayDev*` to
 *      the live scan actions (tree-shaken out of prod).
 *
 * Also anchors the host / balance / merchant queries so they fetch at
 * boot regardless of which screen renders first. Renders nothing.
 *
 * **Permission strategy.** Data-access and payment permissions are
 * requested at boot via the host SDK (triggered by `useHostAuth` and the
 * balance subscription). Camera permission is requested on the scan page
 * only — when the user actually needs it — so the iOS native camera sheet
 * can't race the payment-permission modal. The camera probe fires inside
 * `<ScanPage>` gated on `balancePermissionResolved`; `useCameraStore`
 * publishes the result app-wide from there.
 */

import { useEffect } from "react";

import { useHostAuth } from "@/features/host/api/host-auth.ts";
import { useCoinPaymentHost } from "@/features/host/api/coin-payment-host.ts";
import { usePaymentBalanceDerived } from "@/features/host/api/balance.ts";
import { useMerchantTable } from "@/features/merchants/api/queries.ts";
import { journeyTracker } from "@/shared/utils/telemetry.ts";
import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { useDevHooks } from "@/features/payment/lib/dev-hooks.ts";

export function HostBridge() {
  const { state: authState } = useHostAuth();
  const { status: hostStatus } = useCoinPaymentHost();
  const { state: balanceState } = usePaymentBalanceDerived();
  const { table: merchants, source: merchantTableSource } = useMerchantTable();

  // App-boot journey: opened idempotently, milestones as state resolves.
  // Completed by <AppShell> once routing leaves the boot screen.
  useEffect(() => {
    journeyTracker.start("app-boot");
    if (hostStatus !== "pending") {
      journeyTracker.milestone("app-boot", "host-detected", {
        "boot.host_status": hostStatus,
      });
    }
    if (authState.kind !== "pending") {
      journeyTracker.milestone("app-boot", "auth-resolved", {
        "boot.auth_kind": authState.kind,
      });
    }
    if (balanceState.kind === "ready") {
      journeyTracker.milestone("app-boot", "balance-loaded");
    } else if (balanceState.kind === "error") {
      journeyTracker.milestone("app-boot", "balance-failed");
    }
    if (merchants !== null) {
      journeyTracker.milestone("app-boot", "merchants-loaded", {
        "boot.table_source": merchantTableSource ?? "unknown",
      });
    }
  }, [hostStatus, authState.kind, balanceState.kind, merchants, merchantTableSource]);

  const actions = usePaymentActions();
  useDevHooks({ handleDecoded: actions.handleDecoded, startScan: actions.startScan });

  return null;
}

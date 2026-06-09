// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Invisible side-effect owner for host-derived state. Mounted once under the
 * router root; renders nothing. Opens the `app-boot` journey, anchors the
 * host / merchant queries so they fetch at boot, and binds the dev-standalone
 * `window.__w3spayDev*` console hooks (tree-shaken in prod).
 *
 * Permission strategy: data-access permissions are requested at boot, but
 * camera permission is requested on the scan page only — so the iOS native
 * camera sheet can't race the host's permission modal.
 */

import { useEffect } from "react";

import { useHostAuth } from "@/features/host/api/host-auth.ts";
import { useCoinPaymentHost } from "@/features/host/api/coin-payment-host.ts";
import { useMerchantTable } from "@/features/merchants/api/queries.ts";
import { journeyTracker } from "@/shared/utils/telemetry.ts";
import { usePaymentActions } from "@/features/payment/lib/payment-actions.ts";
import { useDevHooks } from "@/features/payment/lib/dev-hooks.ts";

export function HostBridge() {
  const { state: authState } = useHostAuth();
  const { status: hostStatus } = useCoinPaymentHost();
  const { table: merchants, source: merchantTableSource } = useMerchantTable();

  // App-boot journey: opened idempotently, milestones as state resolves.
  // Completed by <AppShell> once routing leaves the boot screen.
  useEffect(() => {
    journeyTracker.start("w3spay:app-boot");
    if (hostStatus !== "pending") {
      journeyTracker.milestone("w3spay:app-boot", "host-detected", {
        "boot.host_status": hostStatus,
      });
    }
    if (authState.kind !== "pending") {
      journeyTracker.milestone("w3spay:app-boot", "auth-resolved", {
        "boot.auth_kind": authState.kind,
      });
    }
    if (merchants !== null) {
      journeyTracker.milestone("w3spay:app-boot", "merchants-loaded", {
        "boot.table_source": merchantTableSource ?? "unknown",
      });
    }
  }, [hostStatus, authState.kind, merchants, merchantTableSource]);

  const actions = usePaymentActions();
  useDevHooks({ handleDecoded: actions.handleDecoded, startScan: actions.startScan });

  return null;
}

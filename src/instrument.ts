// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

import * as Sentry from "@sentry/react";

import { initTelemetry, sentryRemoteOrigins } from "@/telemetry";
import { requestRemoteOriginPermission } from "@/shared/api/host/connection.ts";

import { envConfig } from "@/config";

const { telemetry } = envConfig;

if (telemetry.enabled) {
  initTelemetry({
    dsn: telemetry.dsn,
    app: "w3spay",
    environment: telemetry.environment,
    tracesSampleRate: telemetry.tracesSampleRate,
  });

  // This app is the payer in the W3S payment cross-app view. Tag every event/
  // span so the cross-app dashboard + reconcile can filter by role. (No shared
  // per-payment id exists yet — see t3rminal-internal#173.)
  Sentry.setTag("pay.role", "payer");

  void requestRemoteOriginPermission(sentryRemoteOrigins(telemetry.dsn));
} else {

  console.info("[w3spay/telemetry] disabled via config.telemetry.enabled");
}

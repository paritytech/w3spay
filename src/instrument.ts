// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

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

  void requestRemoteOriginPermission(sentryRemoteOrigins(telemetry.dsn));
} else {

  console.info("[w3spay/telemetry] disabled via config.telemetry.enabled");
}

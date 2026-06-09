// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Resolved-once env config singleton. The actual env parsing lives in
 * `@/shared/config/read-env.ts`; this module is a thin wrapper that
 * triggers the read at app boot and re-exports the result.
 */

import { parseNetworkKey, type NetworkKey } from "@/shared/api/host";
import { envFlag, envString, requireEnvString } from "@/shared/lib/config";
import { type EnvConfig, parseSupportedPlatforms } from "@/shared/lib/config.ts";


const DEFAULT_W3SPAY_NETWORK: NetworkKey = "paseo-next-v2";

export function readEnv(): EnvConfig {
  const decimals = 6;
  const displayDecimals = 2;
  return {
    contracts: {
      merchantRegistryAddress: envString("VITE_W3SPAY_REGISTRY_ADDRESS", "0x70f6a449d770931419cfa8d8412e3a5d6377e905"),
    },
    merchant: {
      pilotId: envString("VITE_W3SPAY_PILOT_MERCHANT_ID", "funkhaus"),
      registryRetryBudgetMs: 120_000,
      registryRetryIntervalMs: 5_000,
    },
    chain: {
      network:
        parseNetworkKey(import.meta.env.VITE_NETWORK as string | undefined) ?? DEFAULT_W3SPAY_NETWORK,
      readOnlyOrigin: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    },
    token: {
      name: "CASH",
      symbol: "CASH",
      decimals,
      displayDecimals,
      plancksPerCent: 10 ** (decimals - displayDecimals),
    },
    payment: {
      minSpendableCents: 100,
      dummyBalanceCents: 100_000,
      devStartingBalancePlancks: 10_000_000_000,
    },
    host: {
      productDotNs: requireEnvString("VITE_DOTNS_PRODUCT_DOMAIN"),
      productDerivationIndex: 0,
      pollIntervalMs: 50,
      waitTimeoutMs: 3_000,
      standaloneWaitTimeoutMs: 250,
    },
    storage: {
      paymentHistoryKey: "w3spay:payment-history:v2",
      paymentHistoryMaxEntries: 100,
      paymentHistorySchemaVersion: 4,
      receiptsKey: "w3spay:receipts:v1",
      receiptsMaxEntries: 100,
      receiptsSchemaVersion: 2,
    },
    features: {
      tipScreen: false,
      devPaymentOverride: envFlag("VITE_W3SPAY_DEV_PAYMENT_OVERRIDE", true),
      supportedPlatforms: parseSupportedPlatforms(
        envString("VITE_SUPPORTED_PLATFORMS", "mobile,desktop,desktop-app,dotli"),
      ),
    },
    telemetry: {
      // KILL SWITCH. Flip to `false` to ship telemetry disabled (tracker
      // degrades to console-only; no Sentry network calls or handlers).
      enabled: false,
      dsn: envString("VITE_W3SPAY_SENTRY_DSN", ""),
      environment: envString(
        "VITE_W3SPAY_SENTRY_ENV",
        (import.meta.env.MODE as string | undefined) ?? "development",
      ),
      tracesSampleRate: Number(
        envString("VITE_W3SPAY_SENTRY_TRACES_SAMPLE_RATE", "1.0"),
      ),
    },
    debug: {
      enabled: envFlag("VITE_W3SPAY_DEBUG_PANEL", false),
      // Default `true` while hunting the iOS host boot-regression — a
      // session-startup log is our only signal when the host wedges.
      openByDefault: envFlag("VITE_W3SPAY_DEBUG_PANEL_OPEN", false),
      defaultTab: "console",
    },
  };
}


export const envConfig: EnvConfig = readEnv();

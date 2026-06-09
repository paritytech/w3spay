// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * The resolved `EnvConfig` shape and platform-list parsing. The interface
 * documents every field's units, source, and default; the platform helpers
 * live here so `read-env.ts` can stay focused on the env wiring.
 */

import type { NetworkKey } from "@/shared/api/host";
import type { Platform } from "@/shared/api/host/platform";

/**
 * Generic Vite env-reading helpers. Centralised so `import.meta.env` access
 * stays auditable; the config layer (`read-env.ts`) is the only consumer
 * that should need to import from this module.
 */

export function envString(key: string, fallback: string): string {
  const value = import.meta.env[key] as string | undefined;
  return value ?? fallback;
}

/** Required env var: throws at module load if unset or empty. Use for values
 * that MUST be supplied by the deploy (no sensible default). */
export function requireEnvString(key: string): string {
  const value = import.meta.env[key] as string | undefined;
  if (value == null || value.trim() === "") {
    throw new Error(
      `[config] ${key} is required (set it in .env or pass it at build time)`,
    );
  }
  return value;
}

export function envFlag(key: string, fallback: boolean): boolean {
  const raw = import.meta.env[key] as string | undefined;
  if (raw == null) return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}


export interface EnvConfig {
  readonly contracts: {
    /**
     * H160 address of the deployed `W3SPayRegistry`. Empty until
     * `VITE_W3SPAY_REGISTRY_ADDRESS` is set; empty skips the chain step and
     * falls back to the `KvStore` snapshot (no bundled merchant fallback).
     */
    readonly merchantRegistryAddress: string;
  };
  readonly merchant: {
    /**
     * Pilot-mode merchant identifier. A bare TSE receipt carries the till's
     * `kassenSerial` (BSI TR-03151 clientId) but no `merchantId`, so every TSE
     * scan is keyed to this merchant via the on-chain registry row
     * `(pilotId, kassenSerial)`; unregistered tills → `unknownMerchant`.
     * From `VITE_W3SPAY_PILOT_MERCHANT_ID` (default `"funkhaus"`).
     */
    readonly pilotId: string;
    /** How long to retry the on-chain merchant fetch before the "directory unreachable" banner. */
    readonly registryRetryBudgetMs: number;
    /** Interval between registry retry attempts. */
    readonly registryRetryIntervalMs: number;
  };
  readonly chain: {
    /** Active network key. Drives `host/client.ts` chain selection. */
    readonly network: NetworkKey;
    /**
     * Stable read-origin AccountId32 for `eth_call`-style dry-run reads
     * against the revive merchant registry. Changing it breaks every read.
     */
    readonly readOnlyOrigin: string;
  };
  readonly token: {
    /** UI ticker (`"CASH"`), surfaced alongside amounts. */
    readonly symbol: string;
    /** Plancks per cent: `10^(decimals − displayDecimals)`. For CASH, `10_000`. */
    readonly plancksPerCent: number;
  };
  readonly payment: {
    /**
     * Seed MAIN_PURSE balance for the in-memory reference host (dev only), in
     * **plancks** to match the production wire. 10_000_000_000 ≈ 10_000 CASH.
     */
    readonly devStartingBalancePlancks: number;
  };
  readonly host: {
    /** Product DOTNS identifier. From `VITE_DOTNS_PRODUCT_DOMAIN` (REQUIRED — no default; deploy.sh must set it before the build). */
    readonly productDotNs: string;
    /** Product-account derivation index. */
    readonly productDerivationIndex: number;
    /** Poll interval used while waiting for the host bridge to appear. */
    readonly pollIntervalMs: number;
    /** How long to wait for the host bridge inside a real container. */
    readonly waitTimeoutMs: number;
    /**
     * Host-bridge wait in dev-standalone mode before the in-memory fallback.
     * MUST stay shorter than `waitTimeoutMs` or dev boots take a full timeout.
     */
    readonly standaloneWaitTimeoutMs: number;
  };
  readonly storage: {
    /** KvStore key for the local saved-receipts envelope. */
    readonly receiptsKey: string;
    /** Cap on the number of saved receipts kept locally. */
    readonly receiptsMaxEntries: number;
    /**
     * Envelope schema version. Version-mismatched reads are dropped — saved
     * receipts are a local cache, not a fiscal record; no migration path.
     */
    readonly receiptsSchemaVersion: 2;
  };
  readonly features: {
    /**
     * Show the tip-selection screen between scan and confirm. When `false`, a
     * recognised receipt jumps straight to confirm with a 0-cent tip.
     */
    readonly tipScreen: boolean;
    /**
     * Dev-only manual-payment override: a "manual pay" affordance taking a raw
     * AccountId32 hex + CASH amount through the same `host.paymentRequest` path
     * the TSE scan does. NEVER enable this in a public deploy.
     */
    readonly devPaymentOverride: boolean;
    /**
     * Platforms allowed to run the app; others hit `UnsupportedPlatformScreen`
     * before host/auth hooks init. From `VITE_SUPPORTED_PLATFORMS` (comma-
     * separated `Platform` values; default `["mobile"]`).
     */
    readonly supportedPlatforms: readonly Platform[];
  };

  /**
   * Sentry-backed journey + error telemetry. Master switch lives here (not
   * env) so disabling is a code edit; call sites never branch on it because
   * the tracker degrades to console-only when Sentry is uninitialised.
   */
  readonly telemetry: {
    /**
     * Master switch. `false` short-circuits `initTelemetry()` before any
     * `@sentry/react` runs; tracker/`withSpan`/`captureError` keep working as
     * console-only no-ops, so call sites need no guards. Default `true`.
     */
    readonly enabled: boolean;
    /** Sentry DSN; empty string = console-only mode. From `VITE_W3SPAY_SENTRY_DSN`. */
    readonly dsn: string;
    /** Sentry environment label. Defaults to `import.meta.env.MODE`. */
    readonly environment: string;
    /** Traces sample rate (0..1). Default 1.0. Override via `VITE_W3SPAY_SENTRY_TRACES_SAMPLE_RATE`. */
    readonly tracesSampleRate: number;
  };

  /**
   * In-page debug overlay — the mobile webview has no DevTools, so the
   * `<DebugPanel />` toolbox rides along in prod builds, gated by `enabled`.
   * Capture (`console.*`, `window.onerror`, `unhandledrejection`) installs
   * only while the panel is mounted; `VITE_W3SPAY_DEBUG_PANEL=false` strips it.
   */
  readonly debug: {
    readonly enabled: boolean;
    readonly openByDefault: boolean;
    readonly defaultTab: "console" | "timeline" | "host" | "actions";
  };
}

const VALID_PLATFORMS: readonly Platform[] = ["mobile", "desktop", "desktop-app", "dotli"];

export function parseSupportedPlatforms(raw: string): readonly Platform[] {
  if (!raw.trim()) return ["mobile"];
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Platform => (VALID_PLATFORMS as readonly string[]).includes(s));
  return parsed.length > 0 ? parsed : ["mobile"];
}

/**
 * Environment-derived runtime configuration for W3sPay.
 *
 * Everything the app needs from `import.meta.env`, plus the compile-time
 * constants that conceptually belong with them (token identity, payment
 * thresholds, host wait policy, storage envelope, feature flags), is
 * resolved once into a nested `EnvConfig` at module load. Two access
 * shapes are provided:
 *
 *   - `useConfig()` — React hook, the default access path for components
 *     and other hooks. Backed by a context whose default value is the
 *     env-resolved singleton, so call sites need no provider in normal
 *     operation. A `ConfigProvider` is also exported for tests / runtime
 *     overrides if and when that's wanted.
 *
 *   - `envConfig` — module-level singleton, for non-React code (chain
 *     readers, host adapters, storage helpers) where hooks cannot run.
 *
 * Both surfaces return the same object identity in normal operation, so
 * the choice between them is purely about which call site you're in.
 *
 * NEVER reach into `import.meta.env` outside this module — env access is
 * centralized here so a single audit covers what the deploy can override.
 *
 * Units: the host API (RFC 0017 `paymentBalance` / `paymentRequest`)
 * carries amounts in **plancks** — the token's smallest unit,
 * `10^token.decimals` sub-units per token. w3spay's UI works in
 * **cents** (`10^token.displayDecimals` sub-units per token,
 * conventionally 100). All conversion happens at the `PaymentHost`
 * adapter boundary in `src/host/payment-host.ts`; everything downstream
 * is cents.
 *
 * Mirrors `apps/w3spay-admin/src/config.ts` — same nested `EnvConfig`
 * shape, same `envConfig` + `useConfig()` access pair.
 */

import { createContext, useContext } from "react";

import { parseNetworkKey, type NetworkKey } from "@/shared/api/host";
import { detectHostEnvironment } from "@/shared/api/host";

const DEFAULT_W3SPAY_NETWORK: NetworkKey = "paseo-next-v2";

// ─── Platform detection ─────────────────────────────────────────────────

/**
 * The four distinct runtime contexts W3sPay can load in.
 *
 *   - `mobile`       — Polkadot Mobile app native webview (touch device,
 *                      `detectHostEnvironment() === "standalone"`).
 *   - `desktop`      — Standalone desktop browser (mouse/trackpad,
 *                      `detectHostEnvironment() === "standalone"`).
 *   - `desktop-app`  — Polkadot Desktop app Electron webview
 *                      (`detectHostEnvironment() === "desktop-webview"`).
 *   - `dotli`        — dot.li web app iframe
 *                      (`detectHostEnvironment() === "web-iframe"`).
 *
 * Used by `features.supportedPlatforms` to gate the app before any host
 * hooks or queries run.
 */
export type Platform = "mobile" | "desktop" | "desktop-app" | "dotli";

/**
 * Detect the current runtime platform. Synchronous and stable for the
 * page lifetime — safe to call at module load.
 */
export function detectPlatform(): Platform {
  if (typeof window === "undefined") return "mobile";
  const env = detectHostEnvironment();
  if (env === "desktop-webview") return "desktop-app";
  if (env === "web-iframe") return "dotli";
  // Standalone: distinguish by primary pointer device.
  // `pointer: fine` = mouse / trackpad → desktop browser.
  // `pointer: coarse` = touch → mobile native webview.
  return window.matchMedia("(pointer: fine)").matches ? "desktop" : "mobile";
}

// ─── Public type ────────────────────────────────────────────────────────

export interface EnvConfig {
  readonly contracts: {
    /**
     * H160 address of the deployed `W3SPayMerchantRegistry` contract.
     * Empty string until `VITE_W3SPAY_REGISTRY_ADDRESS` is set in the
     * environment; the loader skips the chain step entirely when this
     * is empty and falls back to the cached snapshot in `KvStore` (or
     * an empty table if no cache exists). There is no bundled merchant
     * fallback.
     */
    readonly merchantRegistryAddress: string;
  };
  readonly merchant: {
    /**
     * Pilot-mode merchant identifier. A bare TSE receipt carries the
     * till's `kassenSerial` (BSI TR-03151 clientId) but no `merchantId`,
     * so the scan-resolution path treats every TSE scan as belonging to
     * this merchant and looks up the on-chain
     * `W3SPayMerchantRegistry` row keyed by
     * `(pilotId, kassenSerial)`. Operators must register each pilot till
     * under that pair; unregistered tills resolve to `unknownMerchant`.
     *
     * Sourced from `VITE_W3SPAY_PILOT_MERCHANT_ID`, defaulting to
     * `"funkhaus"`. Remove this field — and the lookup in
     * `app/stage-context.tsx` that uses it — once the t3rminal-issued
     * deeplink scan path lands, since that payload carries
     * `(merchantId, terminalId)` directly.
     */
    readonly pilotId: string;
    /**
     * How long to keep retrying the on-chain merchant fetch before giving
     * up and showing the "directory unreachable" banner.
     */
    readonly registryRetryBudgetMs: number;
    /** Interval between registry retry attempts. */
    readonly registryRetryIntervalMs: number;
  };
  readonly chain: {
    /**
     * Active network key. Drives `host/client.ts` chain selection — the
     * PAPI client for the configured main chain is created on first use
     * by `useAssetHubClient()` and cached for the process lifetime.
     */
    readonly network: NetworkKey;
    /**
     * Stable read-origin AccountId32 for `eth_call`-style dry-run reads
     * against the revive merchant registry. Same constant as the
     * t3rminal index reader. Changing this breaks every read from the
     * merchant registry.
     */
    readonly readOnlyOrigin: string;
  };
  readonly token: {
    /** Verbose token name. Reserved for future display surfaces. */
    readonly name: string;
    /** UI ticker (`"CASH"`), surfaced alongside amounts. */
    readonly symbol: string;
    /** Smallest-unit decimals — the host API speaks in `10^decimals`. */
    readonly decimals: number;
    /** UI display precision. Cents (2) is the only resolution that matters on a receipt. */
    readonly displayDecimals: number;
    /**
     * Plancks per cent — the scale factor between the host API's
     * smallest unit and w3spay's UI cents. Derived:
     * `10^(decimals − displayDecimals)`. For CASH this is `10_000`.
     */
    readonly plancksPerCent: number;
  };
  readonly payment: {
    /** Below this spendable balance, the confirm screen surfaces the top-up hint. */
    readonly minSpendableCents: number;
    /**
     * Synthetic balance shown when the host can't read the user's real
     * one (typically: not signed in, vault uninitialised, or a transient
     * host fault). High enough to clear `minSpendableCents` and any
     * plausible receipt total so the customer can exercise the rest of
     * the flow — the actual `paymentRequest` still goes through the
     * host and will fail if the underlying account isn't funded.
     * Surfaced behind a banner so the customer knows the number is fake.
     */
    readonly dummyBalanceCents: number;
    /**
     * Seed MAIN_PURSE balance for the in-memory reference host (dev
     * only), denominated in **plancks** so the dev path matches the
     * production planck-denominated host wire. 10_000_000_000 plancks
     * ≈ 10_000 CASH.
     */
    readonly devStartingBalancePlancks: number;
  };
  readonly host: {
    /** Fallback product DOTNS identifier when hostname cannot derive one. */
    readonly productDotNs: string;
    /** Product-account derivation index. */
    readonly productDerivationIndex: number;
    /** Poll interval used while waiting for the host bridge to appear. */
    readonly pollIntervalMs: number;
    /** How long to wait for the host bridge inside a real container. */
    readonly waitTimeoutMs: number;
    /**
     * How long to wait for the host bridge in dev-standalone mode
     * before falling back to the in-memory reference. MUST stay shorter
     * than `waitTimeoutMs`, otherwise dev-mode boots take a full host
     * timeout.
     */
    readonly standaloneWaitTimeoutMs: number;
  };
  readonly storage: {
    /** KvStore key for the local payment history envelope. */
    readonly paymentHistoryKey: string;
    /** Cap on the number of entries kept in the local history. */
    readonly paymentHistoryMaxEntries: number;
    /**
     * Schema version for the payment-history envelope. Reads with a
     * mismatched version are dropped — the history is a UI cache, not
     * a fiscal record, so there is no migration path.
     */
    readonly paymentHistorySchemaVersion: 4;
    /** KvStore key for the local saved-receipts envelope. */
    readonly receiptsKey: string;
    /** Cap on the number of saved receipts kept locally. */
    readonly receiptsMaxEntries: number;
    /**
     * Schema version for the saved-receipts envelope. Reads with a
     * mismatched version are dropped — saved receipts are a local
     * record-keeping cache, not a fiscal record, so there is no
     * migration path.
     */
    readonly receiptsSchemaVersion: 2;
  };
  readonly features: {
    /**
     * Show the tip-selection screen between scan and confirm. When
     * `false`, a recognised receipt advances straight from scan to
     * confirm with a 0-cent tip — equivalent to every customer tapping
     * "Skip".
     */
    readonly tipScreen: boolean;
    /**
     * Surface the dev-only manual-payment override. When `true`, a small
     * "manual pay" affordance appears on the scanner screen leading to
     * a form that takes a raw AccountId32 hex + CASH amount and runs the
     * same `host.paymentRequest` path the TSE scan does. Hidden in prod
     * builds; flip on per build (`VITE_W3SPAY_DEV_PAYMENT_OVERRIDE=true`)
     * for the Android test build where the QR scanner host hook is
     * still missing. NEVER enable this in a public deploy.
     */
    readonly devPaymentOverride: boolean;
    /**
     * Platforms on which the app is permitted to run. Any other platform
     * hits the `UnsupportedPlatformScreen` gate before the host bridge or
     * auth hooks initialise.
     *
     * Sourced from `VITE_SUPPORTED_PLATFORMS` as a comma-separated list
     * of `Platform` values. Default: `["mobile"]` — only the Polkadot
     * Mobile native webview.
     *
     * Extend for internal testing:
     *   `VITE_SUPPORTED_PLATFORMS=mobile,desktop`   (add desktop browser)
     *   `VITE_SUPPORTED_PLATFORMS=mobile,dotli`     (add dot.li)
     */
    readonly supportedPlatforms: readonly Platform[];
  };

  /**
   * Sentry-backed productivity telemetry — journey tracking for the
   * customer-pay flow plus error capture. Lives in `EnvConfig` so the
   * master switch is a code edit (`enabled: false` below), not an env
   * hunt; call sites never branch on this because the tracker degrades
   * to console-only mode when Sentry is uninitialised.
   *
   * See `apps/w3spay/src/instrument.ts` for the bootstrap order:
   *   1. read `envConfig.telemetry`
   *   2. if `!enabled` → leave `Sentry.init` uncalled. Tracker still
   *      logs `[Journey:*]` to console.
   *   3. otherwise → `initTelemetry({ dsn, environment, ... })`. If
   *      `dsn === ""`, Sentry initialises with `enabled: false`
   *      internally — same console-only behaviour but the API surface
   *      is live for a runtime DSN injection.
   */
  readonly telemetry: {
    /**
     * Master switch. `false` short-circuits `initTelemetry()` before
     * any `@sentry/react` code runs — no network calls, no global
     * handlers, no breadcrumbs collected. `journeyTracker.*` /
     * `withSpan` / `captureError` calls keep working as console-only
     * no-ops, so call sites need no guards. Default `true`. Flip to
     * `false` here (or in a local override) to kill telemetry for a
     * build without touching call sites or env.
     */
    readonly enabled: boolean;
    /**
     * Sentry DSN. Empty string = console-only mode (tracker logs to
     * `console.info` but uploads nothing). Sourced from
     * `VITE_W3SPAY_SENTRY_DSN`.
     */
    readonly dsn: string;
    /**
     * Sentry environment label (`"production"`, `"pilot"`, `"dev"`).
     * Defaults to `import.meta.env.MODE`.
     */
    readonly environment: string;
    /**
     * Traces sample rate (0..1). Default 1.0 for the pilot. Override
     * via `VITE_W3SPAY_SENTRY_TRACES_SAMPLE_RATE`.
     */
    readonly tracesSampleRate: number;
  };

  /**
   * In-page debug overlay. The host's mobile webview ships only the
   * built SPA — there's no DevTools to peek at when the iOS boot
   * splash sticks. The `<DebugPanel />` toolbox button rides along
   * in production builds and is gated by this flag.
   *
   * - `enabled: true`              → mount the toolbox button + panel.
   *                                  Default `true` for staging and
   *                                  pilot deploys; production
   *                                  public deploys should set
   *                                  `false` via `VITE_W3SPAY_DEBUG_PANEL=false`.
   * - `openByDefault: boolean`     → whether the panel is open on
   *                                  first mount. Default `false` so
   *                                  the toolbox button is the entry
   *                                  point. Set `true` for screenshot
   *                                  harness runs.
   * - `defaultTab: "console" | "timeline" | "host" | "actions"`
   *                                → which tab to show on first
   *                                  open. Default `"console"`.
   *
   * The panel is React-only. The capture (`console.*`, `window.onerror`,
   * `unhandledrejection`) installs as a side-effect of the panel mount
   * — when the panel is disabled, nothing is captured and the
   * ring-buffer stays empty.
   */
  readonly debug: {
    readonly enabled: boolean;
    readonly openByDefault: boolean;
    readonly defaultTab: "console" | "timeline" | "host" | "actions";
  };
}

// ─── Env reader ─────────────────────────────────────────────────────────

function envString(key: string, fallback: string): string {
  const value = import.meta.env[key] as string | undefined;
  return value ?? fallback;
}

function envFlag(key: string, fallback: boolean): boolean {
  const raw = import.meta.env[key] as string | undefined;
  if (raw == null) return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

const VALID_PLATFORMS: readonly Platform[] = ["mobile", "desktop", "desktop-app", "dotli"];

function parseSupportedPlatforms(raw: string): readonly Platform[] {
  if (!raw.trim()) return ["mobile"];
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Platform => (VALID_PLATFORMS as readonly string[]).includes(s));
  return parsed.length > 0 ? parsed : ["mobile"];
}

function readEnv(): EnvConfig {
  const decimals = 6;
  const displayDecimals = 2;
  return {
    contracts: {
      merchantRegistryAddress: envString("VITE_W3SPAY_REGISTRY_ADDRESS", "0xfec1497a5fbfc2583ea52bc7504701f95ea4a68a"),
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
      productDotNs: "w3spay.dot",
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
      // ← KILL SWITCH. Flip to `false` to ship a build with telemetry
      // disabled entirely. The tracker degrades to console-only mode;
      // no Sentry network calls, no global handlers.
      enabled: true,
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
      // Master switch for the in-page toolbox button + draggable
      // overlay (see `@/sdk/host/debug` → `DebugPanel`). Default
      // `true` for staging + pilot deploys; set
      // `VITE_W3SPAY_DEBUG_PANEL=false` for public production
      // deploys to strip the button.
      enabled: envFlag("VITE_W3SPAY_DEBUG_PANEL", true),
      // Default `true` while we're hunting the iOS host boot-regression
      // — a session-startup log is the only signal we have when the
      // host wedges, and the panel is the cheapest place to see it.
      // Set `VITE_W3SPAY_DEBUG_PANEL_OPEN=false` to revert.
      openByDefault: envFlag("VITE_W3SPAY_DEBUG_PANEL_OPEN", false),
      defaultTab: "console",
    },
  };
}

// ─── Singleton + React surface ──────────────────────────────────────────

/** Resolved-once env config. Use from non-React modules. */
export const envConfig: EnvConfig = readEnv();

const ConfigContext = createContext<EnvConfig>(envConfig);

/**
 * React access to the active config. Identity-stable in normal operation
 * (returns the `envConfig` singleton). Tests / runtime overrides can wrap
 * a subtree with `<ConfigProvider value={…}>`.
 */
export function useConfig(): EnvConfig {
  return useContext(ConfigContext);
}

/** Optional provider for tests or scoped overrides. */
export const ConfigProvider = ConfigContext.Provider;

/**
 * Host detection + AccountsProvider singleton.
 *
 * Shared between w3spay and w3spay-admin (and any future product
 * that runs inside a Polkadot host: Desktop webview, mobile/dotli
 * iframe, or standalone). Each app re-exports these helpers from
 * its local `host-connection.ts` and layers app-specific concerns
 * (connection caching, demo-mode, feature flags) on top — see each
 * app's own `src/.../host-connection.ts`.
 *
 * Authentication itself is NOT driven from product code — dotli's
 * topbar owns the QR-login modal (RFC 0009), and Polkadot Desktop
 * drives login through its own UI. Products `subscribeAccountConnectionStatus`
 * and react when the host flips to `"connected"`.
 *
 * ─── Async handshake ────────────────────────────────────────────────
 *
 * The `isSandboxReady()` snapshot is **not** enough on iOS mobile hosts:
 * the `MessagePort` that the SDK talks over is published by the webview
 * shell AFTER the iframe mounts, and the latency between the two can
 * exceed the time it takes React to fire the first effect. Calling any
 * host request (subscribe, getProductAccount) before the port is up
 * races the SDK's lazy `isReady()` and surfaces as
 * `RequestCredentialsErr::Unknown` with reason `"Polkadot host is not
 * ready"`. w3s-conference-app's `injectSpektrExtension()` does the
 * exact same `sandboxTransport.isReady()` wait under a different name
 * — that single gate is what makes its mobile flow work while ours
 * hung on the boot splash.
 *
 * `connectToHost()` exposes that wait as an awaited, cached, timed
 * helper. Both apps call it at boot before any direct host request,
 * with the iOS gate (`injectHostWallet()`) running first so a mobile
 * host that responds to the postMessage-based handshake only after the
 * Spektr extension has been bridged is no longer raced out by the 15s
 * budget firing first.
 */

import {
  createAccountsProvider,
  injectSpektrExtension as sdkInjectSpektrExtension,
  hostApi,
  requestDevicePermission,
  requestPermission,
  sandboxProvider,
  sandboxTransport,
} from "@novasamatech/host-api-wrapper";
import { enumValue } from "@novasamatech/host-api";

declare global {
  interface Window {
    /** Set by Polkadot Desktop's webview shell. */
    __HOST_WEBVIEW_MARK__?: boolean;
  }
}

export type HostEnvironment = "desktop-webview" | "web-iframe" | "standalone";

/**
 * Synchronous DOM-based host detection. Mirrors
 * `t3rminal/lib/host/detect.ts`'s `detectHostEnvironment`. Use this for
 * the initial render — `isInsideContainer()` from `@parity/product-sdk-host`
 * is async and would block the first paint.
 */
export function detectHostEnvironment(): HostEnvironment {
  if (typeof window === "undefined") return "standalone";
  if (window.__HOST_WEBVIEW_MARK__ === true) return "desktop-webview";
  try {
    if (window !== window.top) return "web-iframe";
  } catch {
    // Cross-origin iframe — `window.top` access throws, treat as hosted.
    return "web-iframe";
  }
  return "standalone";
}

/** Convenience: are we anywhere inside a host? */
export function isInHost(): boolean {
  return detectHostEnvironment() !== "standalone";
}

/**
 * Whether the in-page sandbox MessagePort published by the host is
 * actually present. The AccountsProvider will still construct without
 * one, but every request will time out — `connectToHost` uses this as
 * a fast-fail short-circuit, then races `sandboxTransport.isReady()`
 * with a 15s timeout to wait for the port to come up on slow webview
 * bring-up (Polkadot mobile).
 */
export function isSandboxReady(): boolean {
  return sandboxProvider.isCorrectEnvironment();
}

type AccountsProvider = ReturnType<typeof createAccountsProvider>;

/**
 * Lazy singleton AccountsProvider. Giving the whole product one shared
 * instance means every `subscribeAccountConnectionStatus` listener sees
 * the same status stream — important when multiple React effects each
 * want to react to connection changes.
 */
let accountsProvider: AccountsProvider | null = null;

export function getAccountsProvider(): AccountsProvider {
  if (accountsProvider === null) {
    accountsProvider = createAccountsProvider(sandboxTransport);
  }
  return accountsProvider;
}

/**
 * True during `vite dev` only for standalone local runs where no host bridge
 * exists. Hosted dev sessions should exercise the real host path: dotli/TUA
 * through `window.truapi`, or native Polkadot containers through the
 * standard product-sdk Host API.
 *
 * `import.meta.env.DEV` is `false` in production builds, so callers gated by
 * this branch are tree-shaken out of prod bundles regardless of the runtime
 * check.
 */
export function isDevStandalone(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return false;
  return !isInHost() && (window as Window & { truapi?: unknown }).truapi == null;
}

/**
 * iOS platform detection. Covers iPhone / iPod / classic iPad UAs and iPadOS
 * 13+ which sends a Mac UA but is distinguishable via touch points.
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPhone|iPod|iPad/.test(ua)) return true
  if (/Mac/.test(ua) && navigator.maxTouchPoints > 1) return true
  return false
}

/**
 * True when running inside the Polkadot iOS host. Used to apply iOS-host-only
 * workarounds (e.g. the host injects a viewport meta without `viewport-fit=cover`,
 * which collapses `env(safe-area-inset-*)` to 0).
 */
export function isHostIOS(): boolean {
  return isInHost() && isIOS()
}

/**
 * Wall-clock budget for the host-API transport handshake.
 *
 * 15s matches w3s-conference-app's `CONNECT_TIMEOUT_MS` (it bounds the
 * `getProductAccount` round-trip; we bound the underlying `isReady` wait
 * here so the same upper bound applies regardless of which request
 * happens to be first). On Polkadot mobile the webview port can take
 * several seconds to publish on a cold start — anything shorter risks
 * false negatives on first launch after the app has been backgrounded.
 */
export const HOST_HANDSHAKE_TIMEOUT_MS = 15_000;

/**
 * Race a promise against a wall-clock timeout. The timer is always
 * cleared on resolution/rejection so it can't fire after a late winner
 * already settled the race. Private to this module — apps that need
 * the same primitive should re-export via their own utility.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Async handshake cache. The `connected` flag sticks for the lifetime of
 * the page once it has flipped to `true` — repeated `connectToHost()`
 * calls in that state short-circuit to `true` without re-poking the SDK.
 * A `false` outcome is NOT cached: the SDK caches its own wire-level
 * failure, so re-attempts resolve quickly to `false` again, but the
 * caller gets a fresh shot — handy for a "retry" CTA without forcing
 * a page reload.
 */
let connected = false;
let inFlightHandshake: Promise<boolean> | null = null;

/**
 * Await the host-API transport handshake and prime the AccountsProvider
 * singleton. MUST be awaited before any direct host request
 * (`subscribeAccountConnectionStatus`, `getProductAccount`, `requestLogin`,
 * …) — without it, those requests race the handshake and on slow
 * webview-port bring-up (Polkadot mobile) the SDK surfaces
 * `RequestCredentialsErr::Unknown` with reason `"Polkadot host is not
 * ready"`. Mirrors `injectSpektrExtension()` in
 * w3s-conference-app's wallet store, which is the only step that
 * distinguishes its working mobile flow from a stuck boot splash.
 *
 * Returns:
 *   - `true`  once the handshake succeeds within the timeout. Cached
 *             for the rest of the page lifetime.
 *   - `false` outside a host, when the sandbox transport is not in
 *             scope, when the handshake itself fails, OR when the
 *             timeout fires before the host responds. NOT cached —
 *             a subsequent call re-attempts. (The SDK caches its own
 *             wire-level failure, so the second attempt is usually
 *             near-instant.)
 *
 * Concurrent calls share a single in-flight promise; the timeout is
 * bounded by `HOST_HANDSHAKE_TIMEOUT_MS` (15s by default, override
 * per-call for tests).
 *
 * The wallet store's `initInternal` runs `injectHostWallet()` first so
 * the same `sandboxTransport.isReady()` wait is already done by the
 * time this is called in production — the second `isReady()` is a
 * cached no-op at the SDK level, and a real call only happens when
 * `connectToHost` is reached from a non-store caller (tests, direct
 * use).
 */
export async function connectToHost(
  timeoutMs: number = HOST_HANDSHAKE_TIMEOUT_MS,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!isInHost()) return false;
  if (connected) return true;
  if (inFlightHandshake) return inFlightHandshake;

  if (!isSandboxReady()) {
    // Don't short-circuit — on Polkadot mobile the port can take a beat
    // to publish. Fall through to the awaited handshake below, which
    // has its own timeout. Without this branch, the very first React
    // effect on iOS would race the port and we are back to the
    // RequestCredentialsErr::Unknown bug.
    console.log("[host] sandbox transport not yet in scope; awaiting handshake");
  }

  // Prime the AccountsProvider singleton so subsequent `getAccountsProvider()`
  // callers reuse it. Constructing the wrapper does not itself open the
  // connection — `sandboxTransport.isReady()` is what actually completes the
  // handshake.
  // eslint-disable-next-line no-console
  console.info(
    "[host] connectToHost: priming AccountsProvider, awaiting sandboxTransport.isReady()",
  );
  getAccountsProvider();

  inFlightHandshake = withTimeout(
    sandboxTransport.isReady().then((ready) => {
      connected = ready;
      if (ready) {
        // eslint-disable-next-line no-console
        console.info("[host] handshake ok");
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          "[host] handshake did not complete within the SDK budget; transport returned false",
        );
      }
      return ready;
    }),
    timeoutMs,
    "[host] handshake",
  )
    .catch((caught) => {
      const message = caught instanceof Error ? caught.message : String(caught);
      console.warn(`[host] handshake failed: ${message}`);
      connected = false;
      return false;
    })
    .finally(() => {
      inFlightHandshake = null;
    });

  return inFlightHandshake;
}

/** Read the cached handshake outcome (post-`connectToHost` resolution). */
export function isHostConnected(): boolean {
  return connected;
}

// ── Permission-modal serialization ────────────────────────────────

/**
 * The host renders exactly ONE permission / consent modal at a time and
 * silently DROPS any modal request that arrives while another is open.
 * Several subsystems pop modals independently at boot — the Sentry
 * remote-origin grant fired from `instrument.ts` (pre-React,
 * fire-and-forget), the vault balance-access consent from the balance
 * query, and the camera grant from the scan page — so without
 * coordination the later requests race the Sentry modal and vanish. The
 * symptom: only the first modal appears; the rest don't fire until the
 * user leaves and re-enters the app (which drains them because the
 * persisted grants no longer pop a modal).
 *
 * `runExclusiveHostModal` funnels every modal-popping host call through a
 * single FIFO queue: request N+1 only fires once modal N has settled
 * (granted, denied, or timed out). A denial never wedges the queue — the
 * chain advances on settle, not on success.
 *
 * Only wrap discrete request/response calls whose promise settles when
 * the modal closes (`requestPermission`, `requestDevicePermission`,
 * `requestResourceAllocation`, and the one-shot balance subscription that
 * `paymentBalance()` resolves on first value). NEVER wrap a long-lived
 * subscription — the lock would be held for its whole lifetime and
 * starve every later modal.
 */
const HOST_MODAL_MAX_LOCK_MS = 120_000;

let hostModalQueue: Promise<unknown> = Promise.resolve();

export function runExclusiveHostModal<T>(task: () => PromiseLike<T>): Promise<T> {
  // Run the task whether the previous entry resolved or rejected.
  const run = Promise.resolve(hostModalQueue).then(task, task);
  // Advance the tail when this task settles, or after a hard ceiling so a
  // host that never answers a modal can't starve later modals forever.
  // The caller still awaits the real (possibly rejecting) `run`.
  const { promise: ceiling, resolve: openCeiling } = Promise.withResolvers<void>();
  const timer = setTimeout(openCeiling, HOST_MODAL_MAX_LOCK_MS);
  hostModalQueue = Promise.race([
    run.then(
      () => undefined,
      () => undefined,
    ),
    ceiling,
  ]).finally(() => {
    clearTimeout(timer);
  });
  return run;
}

/**
 * Ask the host to grant the camera permission, returning the user's
 * grant/deny decision.
 *
 * **Outside a host:** returns `true` unconditionally. The browser's
 * native `getUserMedia` prompt is the right surface to fall through to
 * — the host's permission modal is meaningless in a regular tab, and
 * a `false` here would deadlock the scanner into its denied state.
 *
 * **Inside a host (dot.li / Polkadot Desktop / mobile):** delegates to
 * `requestDevicePermission("Camera")` from
 * `@novasamatech/host-api-wrapper`. The dot.li iframe only sets
 * `allow="camera"` after the host's modal grants the permission —
 * without this gate, the very first `getUserMedia` call inside the
 * iframe is rejected with a `NotAllowedError` regardless of the user's
 * actual preference.
 *
 * The SDK returns a `ResultAsync<boolean, GenericError>`. We unwrap
 * with `.match()` per the SDK convention:
 *   - `ok(true)`  — granted
 *   - `ok(false)` — denied by the user
 *   - `err(...)`  — transport/encoding error → thrown so the caller's
 *     `try/catch` can decide whether to fall through to getUserMedia
 *     or surface a hard failure.
 */
export async function requestCameraPermission(): Promise<boolean> {
  if (!isInHost()) return true;
  const result = await runExclusiveHostModal(() => requestDevicePermission("Camera"));
  return result.match(
    (granted) => granted,
    (err) => {
      const reason =
        "reason" in err && typeof err.reason === "string" ? err.reason : "unknown";
      throw new Error(`[host] requestCameraPermission failed: ${reason}`);
    },
  );
}


// ── Remote-origin permission ──────────────────────────────────────

/**
 * Outcome of a `requestRemoteOriginPermission` round-trip.
 *
 *   - `granted: true`  — the host allowlisted the origin(s) (or had
 *     already), OR we are outside a host (no sandbox gate — the browser
 *     issues the request directly).
 *   - `granted: false, error: undefined` — user denied at the host prompt.
 *   - `granted: false, error: string`    — transport / handshake failure.
 */
export interface RemoteOriginPermissionOutcome {
  readonly granted: boolean;
  readonly error?: string;
}

/**
 * Per-page-lifetime cache keyed by the sorted origin list. The host
 * persists the decision permanently, but caching avoids re-issuing the
 * transport call when several subsystems ask for the same origins during
 * one session. Only definitive grants are cached — a transient failure
 * (handshake not ready yet) stays retryable.
 */
const remoteOriginOutcomes = new Map<string, RemoteOriginPermissionOutcome>();
const inFlightRemoteOrigins = new Map<string, Promise<RemoteOriginPermissionOutcome>>();

/**
 * Ask the host to allowlist outbound HTTP/WS to one or more origins so
 * `fetch` / `WebSocket` from the sandboxed product iframe can reach them.
 *
 * Outside a host: no sandbox gate exists, so this resolves to
 * `{ granted: true }` without poking the SDK.
 *
 * Never throws: a denied or failed grant must not break the host app, so
 * failures come back as `{ granted: false, error }`.
 *
 * `origins` are bare host patterns per the host-API `Remote` codec — e.g.
 * `"o123.ingest.us.sentry.io"` or `"*.example.com"`. No scheme, no path.
 */
export function requestRemoteOriginPermission(
  origins: readonly string[],
): Promise<RemoteOriginPermissionOutcome> {
  if (!isInHost() || origins.length === 0) {
    return Promise.resolve({ granted: true });
  }
  const key = [...origins].sort().join(",");
  const cached = remoteOriginOutcomes.get(key);
  if (cached) return Promise.resolve(cached);
  const inFlight = inFlightRemoteOrigins.get(key);
  if (inFlight) return inFlight;
  const pending = doRequestRemoteOrigins([...origins])
    .then((outcome) => {
      if (outcome.granted) remoteOriginOutcomes.set(key, outcome);
      return outcome;
    })
    .finally(() => {
      inFlightRemoteOrigins.delete(key);
    });
  inFlightRemoteOrigins.set(key, pending);
  return pending;
}

async function doRequestRemoteOrigins(
  origins: string[],
): Promise<RemoteOriginPermissionOutcome> {
  try {
    const ready = await connectToHost();
    if (!ready) return { granted: false, error: "host transport not ready" };
    return await runExclusiveHostModal(() =>
      requestPermission({ tag: "Remote", value: origins }).match<RemoteOriginPermissionOutcome>(
        (granted) => ({ granted }),
        (err) => ({ granted: false, error: err.payload?.reason ?? err.message }),
      ),
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return { granted: false, error: message };
  }
}
/**
 * Test-only reset for `connectToHost()`'s cache. Production code MUST
 * NOT call this — the connection's stability across a session is part
 * of the boot order that keeps the rest of the app's effects in a
 * consistent state.
 */
export function __resetHostConnectionForTests(): void {
  connected = false;
  inFlightHandshake = null;
  accountsProvider = null;
  injectedExtension = null;
  inFlightInject = null;
  allocationOutcomes.clear();
  inFlightAllocations.clear();
  remoteOriginOutcomes.clear();
  inFlightRemoteOrigins.clear();
}

// ── Spektr extension injection (iOS-specific gate) ────────────────

/**
 * Resource allowances the host supports. Mirrors the conference-app's
 * `REQUIRED_RESOURCES` (w3s-conference-app/packages/shared/host/wallet.ts:20-24).
 * Extend as the host's `AllocatableResource` enum grows; new variants
 * should be added here AND to `isResourceAllowanceKind`'s narrowing.
 */
export type ResourceAllowanceKind =
  | "BulletInAllowance"
  | "SmartContractAllowance:0"
  | "AutoSigning"
  | "PreimageSubmit";

export function isResourceAllowanceKind(value: string): value is ResourceAllowanceKind {
  return (
    value === "BulletInAllowance" ||
    value === "SmartContractAllowance:0" ||
    value === "AutoSigning" ||
    value === "PreimageSubmit"
  );
}

export interface ResourceAllowanceOutcome {
  kind: ResourceAllowanceKind;
  /** `true` if the host granted (or had previously granted) the resource. */
  granted: boolean;
  /** Populated when the host surfaced a transport/encoding error. */
  error?: string;
}

/**
 * Wait for the host's wallet to be bridged as a browser extension into
 * the page's `injectedWeb3` context. This is the iOS-specific step that
 * the conference-app's working mobile flow performs BEFORE any direct
 * host-API request. The SDK's `injectSpektrExtension` internally polls
 * the webview port for bring-up; without it, `sandboxTransport.isReady()`
 * races the port on Polkadot mobile and resolves to `false` even though
 * the host is up.
 *
 * Cached for the page lifetime. A `false` outcome is NOT cached — the
 * SDK's failure is sticky at the wire level, but a re-attempt costs
 * little and a `retry` CTA should be able to recover.
 */
let injectedExtension: boolean | null = null;
let inFlightInject: Promise<boolean> | null = null;

export function injectHostWallet(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!isInHost()) {
    // eslint-disable-next-line no-console
    console.info("[host] injectHostWallet: no host detected; skipping");
    return Promise.resolve(false);
  }
  if (injectedExtension === true) {
    // eslint-disable-next-line no-console
    console.info("[host] injectHostWallet: cached=true (already injected)");
    return Promise.resolve(true);
  }
  if (inFlightInject !== null) {
    // eslint-disable-next-line no-console
    console.info("[host] injectHostWallet: in-flight; sharing existing promise");
    return inFlightInject;
  }
  // eslint-disable-next-line no-console
  console.info(
    "[host] injectHostWallet: starting injectSpektrExtension (iOS webview-port bring-up)",
  );
  const startedAt = Date.now();
  inFlightInject = sdkInjectSpektrExtension()
    .then((ok) => {
      const elapsed = Date.now() - startedAt;
      if (ok) {
        injectedExtension = true;
        // eslint-disable-next-line no-console
        console.info(`[host] injectSpektrExtension ok (${elapsed}ms)`);
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[host] injectSpektrExtension returned false (${elapsed}ms); host wallet unavailable`,
        );
      }
      return ok;
    })
    .catch((caught) => {
      const elapsed = Date.now() - startedAt;
      const reason = caught instanceof Error ? caught.message : String(caught);
      console.warn(
        `[host] injectSpektrExtension threw after ${elapsed}ms: ${reason}`,
      );
      return false;
    })
    .finally(() => {
      inFlightInject = null;
    });
  return inFlightInject;
}

/** Read the cached injection outcome (post-`injectHostWallet` resolution). */
export function isHostWalletInjected(): boolean {
  return injectedExtension === true;
}

// ── Resource allowance claims ─────────────────────────────────────

/**
 * Per-page-lifetime cache of `hostApi.requestResourceAllocation` outcomes.
 * Keyed by resource kind so repeated claims (e.g. a hook re-running) are
 * instant and don't re-prompt the host modal.
 */
const allocationOutcomes = new Map<ResourceAllowanceKind, ResourceAllowanceOutcome>();
const inFlightAllocations = new Map<ResourceAllowanceKind, Promise<ResourceAllowanceOutcome>>();

/** Wall-clock budget for a single claim. The allocation modal is user-interactive. */
export const ALLOC_TIMEOUT_MS = 120_000;

function buildAllocationRequest(kind: ResourceAllowanceKind): unknown {
  switch (kind) {
    case "BulletInAllowance":
      return enumValue("BulletInAllowance", undefined);
    case "SmartContractAllowance:0":
      return enumValue("SmartContractAllowance", 0);
    case "AutoSigning":
      return enumValue("AutoSigning", undefined);
    case "PreimageSubmit":
      return enumValue("PreimageSubmit", undefined);
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown resource allowance: ${String(_exhaustive)}`);
    }
  }
}

function claimOneAllowance(
  kind: ResourceAllowanceKind,
  timeoutMs: number,
): Promise<ResourceAllowanceOutcome> {
  const cached = allocationOutcomes.get(kind);
  if (cached !== undefined) {
    // eslint-disable-next-line no-console
    console.info(`[host] claimAllowance(${kind}): cached ${cached.granted ? "granted" : `denied (${cached.error})`}`);
    return Promise.resolve(cached);
  }
  const inFlight = inFlightAllocations.get(kind);
  if (inFlight !== undefined) {
    // eslint-disable-next-line no-console
    console.info(`[host] claimAllowance(${kind}): in-flight; sharing existing promise`);
    return inFlight;
  }
  // eslint-disable-next-line no-console
  console.info(
    `[host] claimAllowance(${kind}): starting hostApi.requestResourceAllocation (${timeoutMs}ms budget)`,
  );
  const startedAt = Date.now();
  const promise = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ResourceAllowanceOutcome>((resolve) => {
      timer = setTimeout(
        () => resolve({ kind, granted: false, error: `claimAllowance(${kind}) timed out after ${timeoutMs}ms` }),
        timeoutMs,
      );
    });
    const call = runExclusiveHostModal(async () => {
      try {
        const result = await Promise.resolve(
          hostApi.requestResourceAllocation(
            enumValue("v1", [buildAllocationRequest(kind)]) as unknown as Parameters<
              typeof hostApi.requestResourceAllocation
            >[0],
          ),
        );
        return await new Promise<ResourceAllowanceOutcome>((resolve) => {
          result.match(
            (response) => {
              const v = (response as unknown as { tag: string; value: unknown }).value;
              if (v && typeof v === "object" && "tag" in (v as Record<string, unknown>)) {
                const tag = String((v as { tag: unknown }).tag);
                if (tag === "Ok" || tag === "AlreadyGranted") {
                  resolve({ kind, granted: true });
                } else {
                  resolve({ kind, granted: false, error: tag });
                }
              } else {
                // Unknown shape — treat as granted.
                resolve({ kind, granted: true });
              }
            },
            (err) => {
              const reason =
                (err as { payload?: { reason?: string } })?.payload?.reason ?? "unknown";
              resolve({ kind, granted: false, error: reason });
            },
          );
        });
      } catch (caught) {
        const reason = caught instanceof Error ? caught.message : String(caught);
        return { kind, granted: false, error: reason };
      }
    });
    const outcome = await Promise.race([call, timeout]);
    if (timer !== undefined) clearTimeout(timer);
    allocationOutcomes.set(kind, outcome);
    return outcome;
  })();
  inFlightAllocations.set(kind, promise);
  // Resolve the in-flight sentinel before the user's await unblocks
  // so a subsequent claim for the same kind observes the cache.
  void promise.then((outcome) => {
    const elapsed = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.info(
      `[host] claimAllowance(${kind}): ${outcome.granted ? "granted" : `denied (${outcome.error ?? "unknown"})`} (${elapsed}ms)`,
    );
  });
  return promise.finally(() => {
    inFlightAllocations.delete(kind);
  });
}

/**
 * Claim a set of resource allowances from the host. Each claim surfaces
 * the host's modal on first run; subsequent claims are instant. Cached
 * per page lifetime — `__resetHostConnectionForTests` clears the cache.
 *
 * Sequential to keep the modal sequence predictable. A single denial
 * does not abort subsequent claims; the caller can inspect the array
 * to decide whether to proceed.
 */
export function claimResourceAllowances(
  kinds: readonly ResourceAllowanceKind[],
  options: { timeoutMs?: number } = {},
): Promise<readonly ResourceAllowanceOutcome[]> {
  if (typeof window === "undefined") return Promise.resolve([]);
  if (!isInHost()) return Promise.resolve([]);
  const timeoutMs = options.timeoutMs ?? ALLOC_TIMEOUT_MS;
  // Fire sequentially so the host modal chain doesn't stack. `Promise.all`
  // on a sequential `for await` would be equivalent; this is clearer.
  return (async () => {
    const out: ResourceAllowanceOutcome[] = [];
    for (const kind of kinds) {
      out.push(await claimOneAllowance(kind, timeoutMs));
    }
    return out;
  })();
}

/** Read the cached outcomes of prior `claimResourceAllowances` calls. */
export function getResourceAllowanceOutcomes(): readonly ResourceAllowanceOutcome[] {
  return Array.from(allocationOutcomes.values());
}

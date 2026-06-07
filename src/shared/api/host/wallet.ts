/**
 * Host-wallet store. Single source of truth for the resolved product
 * account, signer, and live boot state.
 *
 * Inside a host:
 *   1. `getProductAccount(productIdentifier, derivationIndex)` — also
 *      drives the SDK's internal `sandboxTransport.isReady()` handshake.
 *      Wrapped in a 30s timeout so a never-responding webview port
 *      surfaces an error instead of hanging forever.
 *   2. `getProductAccountSigner(account, "createTransaction")` — host-side
 *      tx encoding so chains with custom signed extensions (`AsPgas` on
 *      Paseo Asset Hub Next) verify. The legacy `host_sign_payload` slot
 *      can't and the runtime rejects with `BadProof`.
 *   3. → `ready`.
 *
 * Outside a host: resolves to `outside-host` immediately and never calls
 * the SDK.
 *
 * Failures patch the store to `{ kind: "error", reason, phase? }`.
 * `retryHostWallet()` re-runs from scratch. `requestAccessHostWallet`
 * opens the host's login modal for apps that gate on an explicit grant.
 */

import { useEffect, useSyncExternalStore } from "react";
import type { ProductAccount as HostProductAccount } from "@novasamatech/host-api-wrapper";
import type { PolkadotSigner } from "polkadot-api";
import { AccountId } from "@polkadot-api/substrate-bindings";

import {
  connectToHost,
  detectHostEnvironment,
  getAccountsProvider,
  isInHost,
  type HostEnvironment,
} from "./connection.ts";
import { recordBootEvent } from "./debug/debug-store.ts";

// ── Public types ─────────────────────────────────────────────────
export type WalletPhase = "connect-host" | "get-product-account" | "build-signer";

export type HostWalletState =
  | { kind: "outside-host"; environment: HostEnvironment }
  | { kind: "pending"; environment: HostEnvironment }
  | { kind: "resolving"; environment: HostEnvironment; phase: WalletPhase }
  | { kind: "requesting-access"; environment: HostEnvironment }
  | {
      kind: "ready";
      environment: HostEnvironment;
      address: string;
      publicKey: Uint8Array;
      productAccount: HostProductAccount;
      signer: PolkadotSigner;
    }
  | { kind: "error"; environment: HostEnvironment; reason: string; phase?: WalletPhase };

export interface HostWalletSnapshot {
  state: HostWalletState;
  address: string | null;
  signer: PolkadotSigner | null;
  isReady: boolean;
  isInitializing: boolean;
  isOutsideHost: boolean;
}

export interface UseHostWalletOptions {
  /** DOTNS product identifier (e.g. `"w3spay.dot"`). */
  productIdentifier: string;
  /** Derivation index for the product account. Defaults to 0. */
  derivationIndex?: number;
}

interface ResolvedHostWalletOptions {
  productIdentifier: string;
  derivationIndex: number;
}

// ── Constants ────────────────────────────────────────────────────

const SS58_PREFIX = 42;
/** Wraps the SDK's internal 10s handshake so a never-responding webview
 *  port (seen on Polkadot mobile when the host hasn't bridged the
 *  message channel yet) eventually surfaces as an error. */
const PRODUCT_ACCOUNT_TIMEOUT_MS = 30_000;

// ── Module state ─────────────────────────────────────────────────

const INITIAL_STATE: HostWalletState = {
  kind: "pending",
  environment: "standalone",
};

let state: HostWalletState = INITIAL_STATE;
let inFlight: Promise<void> | null = null;
let activeOptions: ResolvedHostWalletOptions | null = null;
const listeners = new Set<() => void>();

function setState(next: HostWalletState): void {
  state = next;
  for (const listener of listeners) listener();
}

// ── Init ─────────────────────────────────────────────────────────

async function init(opts: ResolvedHostWalletOptions): Promise<void> {
  if (!isInHost()) {
    console.info("[host-wallet] outside-host: no host detected");
    setState({ kind: "outside-host", environment: "standalone" });
    return;
  }

  const env = detectHostEnvironment();
  const { productIdentifier, derivationIndex } = opts;
  console.info(
    `[host-wallet] init env=${env} id=${productIdentifier} deriv=${derivationIndex}`,
  );

  setState({ kind: "resolving", environment: env, phase: "connect-host" });
  recordBootEvent("handshake", "start");
  const connected = await connectToHost();
  if (!connected) {
    const reason = "host transport handshake failed";
    console.warn(`[host-wallet] ${reason}`);
    recordBootEvent("handshake", "error", reason);
    setState({ kind: "error", environment: env, reason, phase: "connect-host" });
    return;
  }
  recordBootEvent("handshake", "ok");

  setState({ kind: "resolving", environment: env, phase: "get-product-account" });
  recordBootEvent("get-product-account", "start");
  const provider = getAccountsProvider();

  let productAccount: HostProductAccount;
  try {
    console.info("[host-wallet] requesting product account");
    productAccount = await callWithTimeout(
      provider.getProductAccount(productIdentifier, derivationIndex).match(
        (raw) => raw as HostProductAccount,
        (err) => {
          throw err;
        },
      ),
      PRODUCT_ACCOUNT_TIMEOUT_MS,
      "getProductAccount",
    );
  } catch (caught) {
    const reason = describeError(caught);
    console.warn(`[host-wallet] get-product-account failed: ${reason}`);
    recordBootEvent("get-product-account", "error", reason);
    setState({
      kind: "error",
      environment: env,
      reason: `Product account "${productIdentifier}": ${reason}`,
      phase: "get-product-account",
    });
    return;
  }
  recordBootEvent("get-product-account", "ok");

  setState({ kind: "resolving", environment: env, phase: "build-signer" });
  recordBootEvent("build-signer", "start");
  const account: HostProductAccount = {
    dotNsIdentifier: productIdentifier,
    derivationIndex,
    publicKey: productAccount.publicKey,
  };
  const signer = provider.getProductAccountSigner(account, "createTransaction");
  recordBootEvent("build-signer", "ok");

  const address = AccountId(SS58_PREFIX).dec(productAccount.publicKey);
  console.info(`[host-wallet] ready address=${address}`);
  recordBootEvent("ready", "ok", `address=${address}`);
  setState({
    kind: "ready",
    environment: env,
    address,
    publicKey: productAccount.publicKey,
    productAccount: account,
    signer,
  });
}

/** Race a promise against a wall-clock timeout. Real callers get a
 *  ResultAsync that resolves once the host responds; test mocks get a
 *  synchronous value (or a throw). Both flow through `Promise.race`. */
function callWithTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Unwrap neverthrow `CodecError` shapes and `Error.message` into a
 *  single diagnostic string so the boot log surfaces the actual variant
 *  (e.g. `RequestCredentialsErr::DomainNotValid`) and dynamic reason
 *  payload, not the static "Request credentials: unknown error". */
function describeError(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  type CodecLike = { instance?: string; payload?: { reason?: string }; message?: string };
  const top = caught as (CodecLike & { value?: CodecLike }) | undefined;
  const inner = top?.value ?? top;
  const parts = [inner?.instance, inner?.payload?.reason, inner?.message].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : String(caught);
}


// ── Public API ───────────────────────────────────────────────────

/** Auto-initing host-wallet hook. This is the only public hook that starts
 *  host account resolution, so callers must pass the product identity the
 *  host validates. Read-only consumers should use `useHostWalletSnapshot()`. */
export function useHostWallet(opts: UseHostWalletOptions): HostWalletSnapshot {
  useEffect(() => {
    ensureInit(opts);
  }, [opts.productIdentifier, opts.derivationIndex]);
  return useHostWalletSnapshot();
}

function subscribeWallet(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getWalletSnapshot(): HostWalletState {
  return state;
}

/** Subscribe to the current wallet state without starting init. Useful for
 *  generic SDK UI (debug panel, permission gates) and leaf app code that must
 *  observe the root wallet init without owning product identity. */
export function useHostWalletSnapshot(): HostWalletSnapshot {
  const current = useSyncExternalStore(
    subscribeWallet,
    getWalletSnapshot,
    getWalletSnapshot,
  );

  const ready = current.kind === "ready";
  return {
    state: current,
    address: ready ? current.address : null,
    signer: ready ? current.signer : null,
    isReady: ready,
    isInitializing: current.kind === "pending" || current.kind === "resolving",
    isOutsideHost: current.kind === "outside-host",
  };
}

function resolveOptions(opts: UseHostWalletOptions): ResolvedHostWalletOptions {
  if (opts.productIdentifier.length === 0) {
    throw new Error("[host-wallet] productIdentifier must be a non-empty string");
  }
  return {
    productIdentifier: opts.productIdentifier,
    derivationIndex: opts.derivationIndex ?? 0,
  };
}

function ensureInit(opts: UseHostWalletOptions): void {
  if (typeof window === "undefined") return;
  if (!isInHost()) {
    if (state === INITIAL_STATE) {
      setState({ kind: "outside-host", environment: "standalone" });
    }
    return;
  }

  const resolved = resolveOptions(opts);
  const sameActive =
    activeOptions?.productIdentifier === resolved.productIdentifier &&
    activeOptions.derivationIndex === resolved.derivationIndex;

  if (sameActive && inFlight !== null) return;
  if (sameActive && (state.kind === "ready" || state.kind === "error")) return;
  if (inFlight !== null) {
    console.warn("[host-wallet] init already in-flight; ignoring changed product options");
    return;
  }

  activeOptions = resolved;
  inFlight = init(resolved).finally(() => {
    inFlight = null;
  });
}

/** Re-run init from scratch. Used by retry CTAs and by
 *  `requestAccessHostWallet` after a successful grant. Tests may pass
 *  options before a hook has mounted; production retry normally reuses
 *  the active product identity. */
export function retryHostWallet(opts?: UseHostWalletOptions): Promise<void> {
  if (inFlight !== null) return inFlight;
  const resolved = opts !== undefined ? resolveOptions(opts) : activeOptions;
  if (resolved === null) {
    throw new Error("[host-wallet] retryHostWallet called before useHostWallet initialized product options");
  }
  console.info("[host-wallet] retry");
  activeOptions = resolved;
  setState(INITIAL_STATE);
  inFlight = init(resolved).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Ask the host to grant access (admin's "Request access" CTA). On
 *  grant, re-runs init so the wallet transitions to `ready`. On reject
 *  or error, surfaces in the store as `error`. */
export async function requestAccessHostWallet(
  prompt: string,
): Promise<"granted" | "rejected" | "error"> {
  if (!isInHost()) return "error";
  const env = detectHostEnvironment();
  console.info(`[host-wallet] requestAccess prompt="${prompt}"`);
  setState({ kind: "requesting-access", environment: env });

  let decision: "granted" | "rejected" | "error";
  try {
    const result = await Promise.resolve(getAccountsProvider().requestLogin(prompt));
    decision = await new Promise<"granted" | "rejected" | "error">((resolve) => {
      result.match(
        (value) => resolve((value as unknown) === "rejected" ? "rejected" : "granted"),
        (err) => {
          console.warn("[host-wallet] requestLogin error:", err);
          resolve("error");
        },
      );
    });
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    console.warn(`[host-wallet] requestAccess threw: ${reason}`);
    setState({ kind: "error", environment: env, reason });
    return "error";
  }

  console.info(`[host-wallet] requestAccess outcome=${decision}`);
  if (decision === "granted") {
    await retryHostWallet();
  } else {
    setState({ kind: "error", environment: env, reason: decision });
  }
  return decision;
}

// ── Test helpers ─────────────────────────────────────────────────

export function __resetHostWalletForTests(): void {
  state = INITIAL_STATE;
  activeOptions = null;
  inFlight = null;
  for (const listener of listeners) listener();
}

export function __getHostWalletStateForTests(): HostWalletState {
  return state;
}

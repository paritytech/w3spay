/**
 * PAPI `signSubmitAndWatch` observer.
 *
 * Resolves on `txBestBlocksState` (fast — first inclusion) so the UI can
 * advance. We still observe the `finalized` event to emit the terminal
 * `"finalized"` status before unsubscribing.
 *
 * Why this helper exists:
 *   Some host bridges advertise chain support but never wire up
 *   `chainHead_v1_follow` successfully — `signSubmitAndWatch` broadcasts
 *   (the tx lands on chain) yet `txBestBlocksState` never arrives and the
 *   write hangs at `"broadcasting"`. `waitForChainEffect` is the escape
 *   hatch: callers pass an async predicate that reads the state change
 *   the tx was supposed to produce, and the watcher resolves as soon as
 *   that flips. The dry-run that callers do upstream guards against a
 *   predicate that is trivially satisfied by pre-existing state.
 */

import type { PolkadotSigner, TxEvent } from "polkadot-api";

import { stringifyResultValue } from "./read.ts";
import { withTimeout } from "./with-timeout.ts";

export type TxStatus =
  | "idle"
  | "preparing"
  | "signing"
  | "broadcasting"
  | "in-block"
  | "finalized"
  | "error";

export interface WatchableTx {
  readonly decodedCall?: unknown;
  signSubmitAndWatch(
    signer: PolkadotSigner,
    options?: unknown,
  ): {
    subscribe(observer: {
      next(event: TxEvent): void;
      error(error: unknown): void;
    }): { unsubscribe(): void };
  };
}

/**
 * Async predicate the watcher polls after `broadcasted` to detect inclusion
 * indirectly — by observing the state change the caller's tx was supposed
 * to produce.
 *
 *  - Truthy → tx considered included; the watcher advances to `"in-block"`
 *    and resolves with the broadcasted hash.
 *  - Falsy  → keep polling at `pollIntervalMs`.
 *  - Throws → logged and treated as falsy (a transient RPC blip must not
 *    fail the watch). The watchdog still fires if reads stop succeeding
 *    entirely.
 */
export type ChainEffectOracle = () => Promise<boolean>;

export interface WatchTransactionOptions {
  /**
   * Workaround for chains where `chainHead_v1_follow` doesn't deliver
   * `txBestBlocksState` through the host bridge.
   */
  waitForChainEffect?: ChainEffectOracle;
  /** Poll interval. Default 1500ms (~quarter of a block on Asset Hub). */
  pollIntervalMs?: number;
  /** Per-attempt timeout for `waitForChainEffect`. Default 10000ms. */
  pollTimeoutMs?: number;
  /**
   * Upper bound on the wait for the wallet to respond to the signing
   * request — from subscription (the host shows its signing modal) until
   * the first tx event. Default 120000ms. A timeout rejects with a
   * retryable error instead of hanging forever when a stale host signer
   * never surfaces a signing modal.
   */
  signingTimeoutMs?: number;
}

interface TxBestBlocksEvent {
  type: "txBestBlocksState";
  found?: boolean;
  ok?: boolean;
  txHash?: string;
  dispatchError?: unknown;
}

interface TxFinalizedEvent {
  type: "finalized";
  ok?: boolean;
  txHash?: string;
  dispatchError?: unknown;
}

/**
 * Upper bound on the wait between a successful broadcast and on-chain
 * inclusion. Blocks are ~6-12s; anything beyond this means the extrinsic
 * was dropped or rejected after it left the node. We reject so the UI
 * surfaces a retryable failure instead of an infinite spinner.
 *
 * Refreshed on every chain event AND every completed effect-poll read —
 * both prove the node is reachable.
 */
const POST_BROADCAST_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;
const DEFAULT_POLL_TIMEOUT_MS = 10_000;

/**
 * Upper bound on the wait for the wallet to respond to a signing request,
 * spanning subscription (PAPI invokes `signer.signTx`; the host shows its
 * signing modal) until the FIRST tx event — any event proves the bridge is
 * alive. A stale host signer (e.g. after a dropped/restored host connection
 * that left the product-account signer pointing at a dead transport) never
 * resolves `signTx` and never shows a modal; without this bound the watcher
 * hangs forever and the only recovery is an app restart. Generous enough for
 * a human to review and approve an interactive modal.
 */
const SIGNING_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function watchTransaction(
  tx: WatchableTx,
  signer: PolkadotSigner,
  onStatus?: (status: TxStatus) => void,
  options: WatchTransactionOptions = {},
): Promise<`0x${string}`> {
  onStatus?.("signing");
  const { promise, resolve, reject } = Promise.withResolvers<`0x${string}`>();

  let settled = false;
  let pollLoopStopped = false;
  let broadcastedHash: `0x${string}` | undefined;
  let subscription: { unsubscribe(): void } | null = null;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let signingTimer: ReturnType<typeof setTimeout> | undefined;
  const signingTimeoutMs = options.signingTimeoutMs ?? SIGNING_TIMEOUT_MS;

  const clearStall = () => {
    if (stallTimer !== undefined) {
      clearTimeout(stallTimer);
      stallTimer = undefined;
    }
  };

  const clearSigning = () => {
    if (signingTimer !== undefined) {
      clearTimeout(signingTimer);
      signingTimer = undefined;
    }
  };

  const safeUnsubscribe = () => {
    try {
      subscription?.unsubscribe();
    } catch {
      // Best-effort — observable may already be closed.
    }
  };

  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    pollLoopStopped = true;
    clearStall();
    clearSigning();
    onStatus?.("error");
    try {
      subscription?.unsubscribe();
    } finally {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  // Resolve the promise and emit "in-block". Used by both the event path
  // and the polling path; cancellation of the *other* path (subscription
  // for polling, polling-loop flag for events) is the caller's job —
  // event-path callers want the subscription kept open for the
  // subsequent `finalized` notification.
  const succeed = (txHash: `0x${string}`) => {
    if (settled) return;
    settled = true;
    pollLoopStopped = true;
    clearStall();
    clearSigning();
    onStatus?.("in-block");
    resolve(txHash);
  };

  // (Re)arm the post-broadcast inclusion watchdog. Called on every
  // network event after broadcast AND every completed effect-poll read,
  // so a responsive node keeps it from firing; only a true stall (no
  // events, no successful reads for the whole window) rejects.
  const armStall = () => {
    clearStall();
    stallTimer = setTimeout(() => {
      fail(
        new Error(
          `transaction stalled: no inclusion within ${POST_BROADCAST_TIMEOUT_MS}ms of broadcast`,
        ),
      );
    }, POST_BROADCAST_TIMEOUT_MS);
  };

  // Effect-polling loop. Starts from `broadcasted` so we don't fire reads
  // before the tx is in the network; the upstream dry-run is expected to
  // guard against the oracle being trivially satisfied by pre-existing
  // state. Stops as soon as either resolution path settles or the
  // watcher fails.
  const startPolling = () => {
    const probe = options.waitForChainEffect;
    if (!probe) return;
    const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeout = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;

    void (async () => {
      // Yield one microtask before the first poll so a same-tick
      // event-path resolution (e.g. `txBestBlocksState` arriving in the
      // same observer callback as `broadcasted`) can flip
      // `pollLoopStopped` and pre-empt polling entirely. Costs nothing on
      // a live chain (events arrive ms apart, not synchronously) and
      // saves one wasted RPC on the lucky path.
      await Promise.resolve();
      while (!pollLoopStopped && !settled) {
        try {
          const landed = await withTimeout(probe(), timeout, "waitForChainEffect");
          // A completed read proves the node is reachable — refresh the
          // watchdog so polling progress keeps it from spuriously tripping.
          if (!settled) armStall();
          if (landed) {
            succeed(broadcastedHash ?? ("0x" as `0x${string}`));
            // The event path will never deliver `finalized` for us (that
            // would have come via the same broken follow), so close the
            // subscription explicitly to free network resources.
            safeUnsubscribe();
            return;
          }
        } catch (caught) {
          // Read errors are non-fatal — the watchdog still fires if reads
          // stop succeeding entirely. Log so a repeat hang is diagnosable.
          console.warn("[watch-transaction] effect poll error (continuing)", caught);
        }
        if (pollLoopStopped || settled) return;
        await sleep(interval);
      }
    })();
  };

  // Signing-phase watchdog. Armed before we subscribe (subscribing invokes
  // `signer.signTx`, which is what surfaces the host signing modal) and
  // cleared on the first tx event below — any event proves the wallet
  // responded. A stale signer that never responds (dead host bridge, modal
  // never appears) would otherwise hang the watcher forever; this converts
  // that into a retryable error the UI can surface.
  signingTimer = setTimeout(() => {
    fail(
      new Error(
        `signing request timed out: no wallet response within ${signingTimeoutMs}ms ` +
          "(the host signing modal may not have appeared — reconnect the wallet and try again)",
      ),
    );
  }, signingTimeoutMs);

  subscription = tx
    .signSubmitAndWatch(signer, { mortality: { mortal: true, period: 256 } })
    .subscribe({
      next(event) {
        // Any event proves the wallet responded and the bridge is live —
        // stand down the signing-phase watchdog.
        clearSigning();
        // Diagnostics: log every tx event so a "stuck on broadcasting"
        // recurrence shows EXACTLY where tracking stops.
        const evt = event as {
          type: string;
          found?: boolean;
          ok?: boolean;
          txHash?: string;
        };
        console.info("[watch-transaction] tx event", {
          type: evt.type,
          found: evt.found,
          ok: evt.ok,
          txHash: evt.txHash,
        });

        if (event.type === "signed") onStatus?.("signing");
        if (event.type === "broadcasted") {
          onStatus?.("broadcasting");
          armStall();
          // Capture the broadcasted hash so a polling-based resolution can
          // still surface the right txHash to the caller — the oracle path
          // doesn't observe chain events.
          broadcastedHash = evt.txHash as `0x${string}` | undefined;
          startPolling();
        }

        if (event.type === "txBestBlocksState") {
          armStall();
          const ev = event as TxBestBlocksEvent;
          if (ev.found) {
            if (ev.ok === false) {
              fail(new Error(`transaction failed in block: ${formatDispatchError(ev.dispatchError)}`));
              return;
            }
            succeed((ev.txHash ?? "0x") as `0x${string}`);
          }
        }

        if (event.type === "finalized") {
          const ev = event as TxFinalizedEvent;
          if (!settled) {
            if (ev.ok === false) {
              fail(new Error(`transaction finalized with dispatch error: ${formatDispatchError(ev.dispatchError)}`));
              return;
            }
            succeed((ev.txHash ?? "0x") as `0x${string}`);
          }
          onStatus?.("finalized");
          safeUnsubscribe();
        }
      },
      error(error) {
        fail(error);
      },
    });

  return promise;
}

function formatDispatchError(error: unknown): string {
  if (error == null) return "unknown dispatch error";
  if (typeof error === "string") return error;
  return stringifyResultValue(error);
}

import {
  createPaymentManager,
  sandboxProvider,
  sandboxTransport,
  type PaymentStatus,
} from "@/shared/api/host";

import { envConfig } from "@/shared/config.ts";

export interface PaymentHostBalance {
  /** Spendable balance in **cents** (1/100 of CASH, 1/10⁴ of a planck). */
  available: number;
}

export interface PaymentHostReceipt {
  id: string;
  /**
   * Settlement state of the payment after the host returned its receipt.
   *  - `settled`     — host observed a terminal `completed` status.
   *  - `unconfirmed` — host accepted the request but the settlement
   *    subscription was interrupted before a terminal status arrived.
   *    The on-chain extrinsic may still have settled; callers MUST
   *    surface the ambiguity and reconcile against the host vault.
   *
   * Optional for backwards-compatible defaulting; absent ⇒ `settled`.
   */
  settlement?: "settled" | "unconfirmed";
}

/**
 * Narrow payer-side payment surface w3spay actually uses.
 *
 * **Units.** Every amount on this interface is **cents**. The underlying
 * host API (RFC 0017 `paymentBalance` / `paymentRequest`) carries amounts
 * in the token's smallest unit — **plancks** — which for CASH is 10⁶ per
 * token (and 10⁴ per cent). Conversion happens inside the adapter
 * below; nothing outside this file needs to know about plancks.
 */
export interface PaymentHost {
  paymentBalance(): Promise<PaymentHostBalance>;
  paymentRequest(amountCents: number, destination: Uint8Array): Promise<PaymentHostReceipt>;
}

/** Balance payload the standard host payment manager pushes. */
export interface PaymentBalance {
  available: bigint;
}

/**
 * Host-API subscription handle. Mirrors the shape
 * `@/sdk/host`'s `createPaymentManager` returns from its
 * `subscribe*` methods — a named contract so this module never reaches
 * into `ReturnType<typeof createPaymentManager>`.
 */
export interface PaymentSubscription {
  unsubscribe(): void;
  onInterrupt(callback: (payload: unknown) => void): unknown;
}

/**
 * The slice of the standard host payment manager w3spay drives. The full
 * manager returned by `createPaymentManager` is structurally assignable to
 * this; we name only the three methods the cents adapter touches.
 */
export interface StandardPaymentManager {
  subscribeBalance(callback: (balance: PaymentBalance) => void): PaymentSubscription;
  requestPayment(amount: bigint, destination: Uint8Array): Promise<{ id: string }>;
  subscribePaymentStatus(
    id: string,
    callback: (status: PaymentStatus) => void,
  ): PaymentSubscription;
}

export interface ResolvePaymentHostOptions {
  devStandalone: boolean;
  hosted: boolean;
  hostApiReady: boolean;
  getDevHost: () => PaymentHost;
  createStandardHost?: () => PaymentHost;
}

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const PLANCKS_PER_CENT_BIGINT = BigInt(envConfig.token.plancksPerCent);

/**
 * Resolve the payer payment surface.
 *
 * w3spay supports the standard Polkadot host payment API only. In
 * `vite dev` standalone there is no host, so an in-memory dev host keeps
 * the local loop usable; inside a host we build the standard manager
 * adapter once the host API is ready; otherwise there is nothing to pay
 * through and we return `null` so routing can surface `hostUnavailable`.
 */
export function resolvePaymentHost(options: ResolvePaymentHostOptions): PaymentHost | null {
  if (options.devStandalone) return options.getDevHost();

  if (options.hosted && options.hostApiReady) {
    return (options.createStandardHost ?? createStandardPaymentHost)();
  }

  return null;
}

/**
 * Synchronous fast-fail for the standard Host API environment check.
 *
 * **Production code should NOT use this directly** — on iOS mobile the
 * `sandboxProvider.isCorrectEnvironment()` flag is `false` until
 * `injectSpektrExtension()` publishes the Spektr wallet as a browser
 * extension (see `@/sdk`'s `connectToHost` + `injectHostWallet`).
 * Callers that need an awaited product-account signal should read
 * `useHostWalletSnapshot().isReady` after the root auth hook has initialized
 * the host wallet.
 *
 * Kept exported for tests that want to assert the SDK's transport
 * state without spinning up a React tree.
 */
export function isStandardPaymentHostReady(): boolean {
  return sandboxProvider.isCorrectEnvironment();
}

/**
 * Adapter over the standard product-sdk Host API. The underlying wire
 * carries `bigint` planck values, so we do the integer division in
 * `bigint` first and then coerce to `number` cents — never the other way
 * around. Nothing outside this file sees plancks.
 */
export function createStandardPaymentHost(
  manager: StandardPaymentManager = createPaymentManager(sandboxTransport),
): PaymentHost {
  return {
    async paymentBalance() {
      return new Promise<PaymentHostBalance>((resolve, reject) => {
        let settled = false;
        let subscription: PaymentSubscription | null = null;

        const settle = (callback: () => void) => {
          if (settled) return;
          settled = true;
          subscription?.unsubscribe();
          callback();
        };

        subscription = manager.subscribeBalance((balance) => {
          settle(() => {
            try {
              const cents = balance.available / PLANCKS_PER_CENT_BIGINT;
              resolve({
                available: safeNumberFromBigInt(cents, "payment balance"),
              });
            } catch (caught) {
              reject(caught);
            }
          });
        });

        subscription.onInterrupt((payload) => {
          settle(() => {
            reject(
              new Error(
                `Payment balance subscription interrupted: ${describeUnknown(payload)}`,
              ),
            );
          });
        });

        if (settled) subscription.unsubscribe();
      });
    },
    async paymentRequest(amountCents, destination) {
      const amountPlancks = BigInt(amountCents) * PLANCKS_PER_CENT_BIGINT;
      const receipt = await manager.requestPayment(amountPlancks, destination);
      const settlement = await awaitPaymentSettled(manager, receipt.id);
      return { id: receipt.id, settlement };
    },
  };
}

/**
 * Block until the standard host reports a terminal payment status. The native
 * Android Host API returns from `requestPayment` synchronously, before the
 * on-chain extrinsic has been broadcast — the worker drives settlement in the
 * background and emits `processing` → `completed` (or `failed`) on the status
 * subscription. Awaiting that subscription here keeps the returned receipt
 * post-finalization.
 *
 * Settlement outcomes:
 *  - `"settled"`     — terminal `completed` status observed.
 *  - `"unconfirmed"` — the status subscription was interrupted before a
 *    terminal status arrived. The on-chain extrinsic may still have
 *    settled in a background worker; the receipt is surfaced with
 *    `settlement: "unconfirmed"` so the UI can prompt the user to
 *    reconcile rather than mis-classifying the payment as failed.
 *
 * Terminal `failed` status still rejects — that's an explicit host
 * verdict that the payment did NOT go through.
 */
function awaitPaymentSettled(
  manager: StandardPaymentManager,
  paymentId: string,
): Promise<"settled" | "unconfirmed"> {
  return new Promise<"settled" | "unconfirmed">((resolve, reject) => {
    let settled = false;
    let subscription: PaymentSubscription | null = null;

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      subscription?.unsubscribe();
      callback();
    };

    subscription = manager.subscribePaymentStatus(paymentId, (status) => {
      if (status.type === "processing") return;
      if (status.type === "completed") {
        settle(() => resolve("settled"));
        return;
      }
      settle(() => reject(new Error(`Payment failed: ${status.reason}`)));
    });

    subscription.onInterrupt((payload) => {
      settle(() => {
        // Subscription died mid-flight. The host worker may still settle
        // the extrinsic; we deliberately do NOT reject — promoting an
        // unknown to a definite failure would mis-classify settled
        // payments as failed and either lose a history record (today's
        // C1 bug) or re-charge on retry. Surface as `unconfirmed` and
        // let the UI reconcile.
        console.warn(
          "[w3spay/host] payment status subscription interrupted; treating as unconfirmed",
          describeUnknown(payload),
        );
        resolve("unconfirmed");
      });
    });

    if (settled) subscription.unsubscribe();
  });
}

export function safeNumberFromBigInt(value: bigint, label: string): number {
  if (value > MAX_SAFE_INTEGER_BIGINT || value < MIN_SAFE_INTEGER_BIGINT) {
    throw new RangeError(
      `${label} ${value.toString()} is outside the Number.MAX_SAFE_INTEGER range`,
    );
  }

  return Number(value);
}

function describeUnknown(value: unknown): string {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

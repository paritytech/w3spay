/**
 * Resolve the narrow `PaymentHost` exposed by the surrounding Polkadot
 * host (Desktop webview / iframe / native mobile) via the standard
 * product-sdk Host API, modelled as a TanStack Query.
 *
 * The host API can become usable synchronously before React mounts, but
 * on iOS mobile `sandboxProvider.isCorrectEnvironment()` returns `false`
 * until `injectSpektrExtension()` has published the Spektr wallet — which
 * is why resolution is a poll, not a one-shot read:
 *
 *   1. The query fn attempts a synchronous resolve on every run (the
 *      first run covers the ready-at-boot case).
 *   2. While the attempt yields no host AND the wait budget hasn't
 *      elapsed, the query keeps `status: "pending"` and `refetchInterval`
 *      re-runs it every `pollIntervalMs`. Each re-run reads the *current*
 *      `useHostWalletSnapshot().isReady`, so the poll naturally observes
 *      product account resolution completing.
 *   3. While the host wallet is still resolving product-account state,
 *      stay `pending` regardless of the wait budget. The host transport is
 *      already detected at that point; declaring timeout would race Android's
 *      slower `host_account_get` response and route to `hostUnavailable`.
 *   4. Once the wait budget elapses with no wallet init in flight: in
 *      `vite dev` standalone we fall back to the in-memory reference host;
 *      otherwise we settle on `status: "timeout"` and routing surfaces
 *      `hostUnavailable`.
 *
 * Polling stops the moment the query settles on `ready` or `timeout`
 * (`refetchInterval` returns `false`), so the resolved host is built
 * exactly once.
 *
 * Status surface (`CoinPaymentHostStatus`) is unchanged from the former
 * effect-based hook so `payment-flow` consumers and the routing gate read
 * the same three states (`pending` / `ready` / `timeout`).
 */

import { useRef } from "react";

import { useQuery } from "@tanstack/react-query";
import { isDevStandalone, isInHost, useHostWalletSnapshot } from "@/shared/api/host";

import { envConfig } from "@/shared/config.ts";
import { hostKeys } from "@/features/host/api/keys.ts";
import { getDevPaymentHost } from "@/features/host/lib/dev-payment-host.ts";
import {
  resolvePaymentHost,
  type PaymentHost,
} from "@/features/host/lib/payment-host.ts";

export type CoinPaymentHostStatus = "pending" | "ready" | "timeout";

export interface CoinPaymentHostResult {
  readonly host: PaymentHost | null;
  readonly status: CoinPaymentHostStatus;
}

/**
 * Pure status reducer. Kept (and exported) so the transition table stays
 * testable without React or wall-clock waits, and is the single decision
 * point the query fn below routes through.
 *
 *  - `resolvedHost != null`              → `"ready"`
 *  - else if `elapsedMs >= timeoutMs`    → `"timeout"`
 *  - else                                → `"pending"`
 *
 * `timeoutMs <= 0` is treated as "timed out immediately" — keeps the
 * function total without a separate edge case.
 */
export function coinPaymentHostStatus(
  resolvedHost: PaymentHost | null,
  elapsedMs: number,
  timeoutMs: number,
): CoinPaymentHostStatus {
  if (resolvedHost !== null) return "ready";
  if (elapsedMs >= timeoutMs) return "timeout";
  return "pending";
}

const PENDING: CoinPaymentHostResult = { host: null, status: "pending" };

export function useCoinPaymentHost(): CoinPaymentHostResult {
  // Reading the wallet snapshot gates the standard Host API branch on the
  // product-account resolution completing and re-renders us (and thus
  // refreshes the query fn closure) when `isReady` flips.
  const wallet = useHostWalletSnapshot();

  // Boot timestamp survives the poll cycle; only the first render's value
  // is retained (StrictMode re-mount simply restarts the budget).
  const startedAtRef = useRef<number>(Date.now());

  // 15s budget inside a real container (iOS webview-port bring-up); much
  // shorter standalone before we hand the dev host over.
  const timeoutMs = isInHost()
    ? envConfig.host.waitTimeoutMs
    : envConfig.host.standaloneWaitTimeoutMs;

  const query = useQuery<CoinPaymentHostResult>({
    queryKey: hostKeys.coinPaymentHost(),
    queryFn: () => {
      const host = resolvePaymentHost({
        devStandalone: false,
        hosted: isInHost(),
        hostApiReady: wallet.isReady,
        getDevHost: getDevPaymentHost,
      });
      if (host !== null) return { host, status: "ready" };
      if (wallet.isInitializing) return PENDING;
      const status = coinPaymentHostStatus(
        null,
        Date.now() - startedAtRef.current,
        timeoutMs,
      );
      if (status === "timeout") {
        // Re-check the dev gate after the wait — in dev standalone the
        // in-memory reference keeps the local loop usable; in production
        // a missing bridge becomes `hostUnavailable` upstream.
        return isDevStandalone()
          ? { host: getDevPaymentHost(), status: "ready" }
          : { host: null, status: "timeout" };
      }
      return PENDING;
    },
    // Keep polling only while unresolved; stop on ready/timeout.
    refetchInterval: (q) =>
      q.state.data?.status === "pending" ? envConfig.host.pollIntervalMs : false,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  return query.data ?? PENDING;
}

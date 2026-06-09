// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Readiness signal for the surrounding Polkadot host's payment bridge.
 * Polls the host-API wallet snapshot until the bridge resolves (or the
 * budget expires), then exposes a `status` for the routing gate. The
 * actual send path lives in `@/features/payment/api/send-payment.ts` and
 * resolves the host SDK manager itself — this hook does NOT expose a host
 * object.
 */

import { useRef } from "react";

import { useQuery } from "@tanstack/react-query";
import { isDevStandalone, isInHost, useHostWalletSnapshot } from "@/shared/api/host";

import { envConfig } from "@/config";
import { hostKeys } from "@/features/host/api/keys.ts";

export type CoinPaymentHostStatus = "pending" | "ready" | "timeout";

export interface CoinPaymentHostResult {
  readonly status: CoinPaymentHostStatus;
}

/**
 * Pure status reducer — exported so the transition table is testable
 * without React or wall-clock waits. `timeoutMs <= 0` is treated as
 * timed-out immediately, keeping the function total.
 */
export function coinPaymentHostStatus(
  bridgeReady: boolean,
  elapsedMs: number,
  timeoutMs: number,
): CoinPaymentHostStatus {
  if (bridgeReady) return "ready";
  if (elapsedMs >= timeoutMs) return "timeout";
  return "pending";
}

const PENDING: CoinPaymentHostResult = { status: "pending" };
const READY: CoinPaymentHostResult = { status: "ready" };
const TIMEOUT: CoinPaymentHostResult = { status: "timeout" };

export function useCoinPaymentHost(): CoinPaymentHostResult {
  // Reading the wallet snapshot gates the bridge-ready branch on the
  // product-account resolution completing and re-renders us (and thus
  // refreshes the query fn closure) when `isReady` flips.
  const wallet = useHostWalletSnapshot();

  // Boot timestamp survives the poll cycle; only the first render's value
  // is retained (StrictMode re-mount simply restarts the budget).
  const startedAtRef = useRef<number>(Date.now());

  // 15s budget inside a real container (iOS webview-port bring-up); much
  // shorter standalone before we declare the in-memory dev path usable.
  const timeoutMs = isInHost()
    ? envConfig.host.waitTimeoutMs
    : envConfig.host.standaloneWaitTimeoutMs;

  const query = useQuery<CoinPaymentHostResult>({
    queryKey: hostKeys.coinPaymentHost(),
    queryFn: () => {
      const bridgeReady = isInHost() && wallet.isReady;
      if (bridgeReady) return READY;
      if (wallet.isInitializing) return PENDING;
      const status = coinPaymentHostStatus(
        false,
        Date.now() - startedAtRef.current,
        timeoutMs,
      );
      if (status === "timeout") {
        // Re-check the dev gate after the wait — in dev standalone the
        // in-memory reference manager keeps the local loop usable; in
        // production a missing bridge becomes `hostUnavailable` upstream.
        return isDevStandalone() ? READY : TIMEOUT;
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

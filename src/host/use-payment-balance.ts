import { useEffect, useState } from "react";
import { isInsideContainer } from "@parity/product-sdk-host";
import { paymentManager } from "@novasamatech/product-sdk";

/**
 * Resolved-balance state machine.
 *
 * - `pending` — we are inside the host, the subscription is open, but no
 *   `PaymentBalance` push has arrived yet. UI should not block on this:
 *   surface "checking…" but still allow the user to proceed (the host
 *   does its own `InsufficientBalance` check on the actual request).
 * - `available` — at least one balance push has been received.
 * - `permissionDenied` — RFC 0006 §"Balance subscription consent": the
 *   user declined the first-time prompt. We treat this as fail-open and
 *   defer to the host's payment-side error on the actual request.
 * - `unsupported` — we are not inside the host (no postMessage transport),
 *   or the host doesn't implement RFC 0006 at all. Same fail-open posture.
 * - `error` — subscription interrupted with `Unknown(GenericErr)`.
 */
export type PaymentBalanceState =
  | { kind: "pending" }
  | { kind: "available"; availableUnits: bigint }
  | { kind: "permissionDenied" }
  | { kind: "unsupported" }
  | { kind: "error"; reason: string };

/**
 * Subscribe to RFC 0006 `host_payment_balance_subscribe`. The host prompts
 * the user on first call; subsequent updates push automatically when the
 * balance changes (including after a successful `paymentRequest`).
 *
 * Eager (mount-time) subscription is the deliberate UX choice: one prompt
 * at app launch beats interrupting the customer's flow right when they're
 * about to confirm payment.
 */
export function usePaymentBalance(): PaymentBalanceState {
  const [state, setState] = useState<PaymentBalanceState>({ kind: "pending" });

  useEffect(() => {
    let cancelled = false;
    let subscription: { unsubscribe: () => void } | null = null;

    void (async () => {
      let inside: boolean;
      try {
        inside = await isInsideContainer();
      } catch (caught) {
        console.warn("[w3spay/balance] isInsideContainer threw", caught);
        if (!cancelled) setState({ kind: "unsupported" });
        return;
      }
      if (cancelled) return;
      if (!inside) {
        console.info("[w3spay/balance] not inside host container — skipping subscription");
        setState({ kind: "unsupported" });
        return;
      }
      console.info("[w3spay/balance] inside host — opening paymentManager.subscribeBalance");
      try {
        const sub = paymentManager.subscribeBalance((balance) => {
          if (cancelled) return;
          console.info("[w3spay/balance] push received", {
            availableUnits: balance.available.toString(),
          });
          setState({ kind: "available", availableUnits: balance.available });
        });
        sub.onInterrupt((payload) => {
          if (cancelled) return;
          console.warn("[w3spay/balance] subscription interrupted", payload);
          if (payload.name === "PaymentBalanceErr::PermissionDenied") {
            setState({ kind: "permissionDenied" });
            return;
          }
          const reason =
            payload.name === "PaymentBalanceErr::Unknown" && payload.payload?.reason
              ? payload.payload.reason
              : "balance subscription interrupted";
          setState({ kind: "error", reason });
        });
        if (cancelled) {
          sub.unsubscribe();
          return;
        }
        subscription = sub;
        console.info("[w3spay/balance] subscription open; waiting for first push");
      } catch (caught) {
        if (cancelled) return;
        console.error("[w3spay/balance] subscribeBalance threw", caught);
        setState({
          kind: "error",
          reason: caught instanceof Error ? caught.message : String(caught),
        });
      }
    })();

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  return state;
}

/**
 * Pre-flight check: is the requested amount definitely more than the user
 * has? Returns `false` for any non-`available` state — fail-open so we
 * never block on a permission-denied or still-pending balance.
 */
export function isKnownInsufficient(
  balance: PaymentBalanceState,
  amountUnits: bigint,
): boolean {
  return balance.kind === "available" && balance.availableUnits < amountUnits;
}

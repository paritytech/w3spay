/**
 * `useHostAuth` — legacy shim over `@/sdk`'s `useHostWallet`
 * auto-initing store.
 *
 * Historical context: this hook used to be a 200-line state machine
 * that hand-rolled the boot sequence (handshake + subscribe) for the
 * customer flow. With the w3s-conference-app parity refactor it became
 * a thin adapter: it consumes `useHostWallet` and projects the new
 * `HostWalletState` union into the historical `HostAuthState` union
 * that `payment-flow-context.tsx` and friends still depend on.
 *
 * New code SHOULD consume `useHostWallet` directly to get the full
 * state (signer, allowances, product account). The shim only exists
 * to keep the existing consumer surface stable.
 */
import { useHostWallet, type HostWalletState as NewState } from "@/shared/api/host";
import { envConfig } from "@/shared/config.ts";

/**
 * Legacy host-auth state union, preserved for `payment-flow-context.tsx`
 * and the rest of the customer flow. The w3spay admin's
 * `useProductAccount` does NOT use this — it has a richer state.
 */
export type HostAuthState =
  | { kind: "pending" }
  | { kind: "outsideHost" }
  | { kind: "disconnected" }
  | { kind: "connected" }
  | { kind: "error"; reason: string };

export interface UseHostAuthResult {
  state: HostAuthState;
}

/**
 * Project the new store's state into the historical `HostAuthState`.
 *
 * Mapping:
 *   - `outside-host`        → `outsideHost`   (no host detected)
 *   - `ready`               → `connected`     (handshake + product account
 *                                              resolved + allowances claimed)
 *   - `requesting-access`   → `disconnected`  (transient — host modal open)
 *   - `error`               → `error`         (with the upstream reason)
 *   - `pending` / `resolving` → `pending`     (boot in flight)
 */
export function useHostAuth(): UseHostAuthResult {
  // Derive the product identifier from the current hostname — mirrors the
  // logic in apps/w3spay-admin/src/lib/util/get-admin-product-id.ts.
  // The host validates the product by the URL the webview/iframe is loaded
  // from, so we must match its derivation exactly.
  const productIdentifier = envConfig.host.productDotNs;
  const wallet = useHostWallet({
    productIdentifier,
    derivationIndex: envConfig.host.productDerivationIndex,
  });
  console.info("[useProductAccount] wallet state:", wallet.state);
  console.info("[useProductAccount] wallet address:", wallet.address);
  return { state: projectAuthState(wallet.state) };
}

function projectAuthState(s: NewState): HostAuthState {
  switch (s.kind) {
    case "outside-host":
      return { kind: "outsideHost" };
    case "ready":
      return { kind: "connected" };
    case "requesting-access":
      return { kind: "disconnected" };
    case "error":
      return { kind: "error", reason: s.reason };
    case "pending":
    case "resolving":
      return { kind: "pending" };
    default: {
      const _exhaustive: never = s;
      void _exhaustive;
      return { kind: "pending" };
    }
  }
}

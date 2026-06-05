/**
 * PAPI client cache shared by every product that talks to a Polkadot
 * chain through `polkadot-api`.
 *
 * Provider strategy:
 *
 *   - **In host** (Polkadot Desktop webview, dotli iframe, native mobile):
 *     `createPapiProvider(genesis)` from `@novasamatech/host-api-wrapper`. The
 *     SDK probes the host with `host_feature_supported(Chain, genesis)`.
 *     When the host advertises the chain, all JSON-RPC flows through the
 *     host bridge — required on mobile, where the sandboxed iframe cannot
 *     open arbitrary WSS sockets. When the host does NOT advertise the
 *     chain, the SDK falls through to the WS provider instead of returning
 *     a dead provider that silently hangs every send.
 *
 *   - **Standalone** (regular browser tab):
 *     Direct WSS to `wsFallback`.
 *
 * Why a host-detection predicate is passed in:
 *
 *   `getOrCreateClient` is environment-aware, but the predicate is
 *   provided by the caller (each app's local `host-connection.ts`)
 *   rather than imported from `./connection.ts`. This keeps the cache
 *   module mockable — tests can pass a stubbed predicate without
 *   reaching into shared-package internals.
 *
 * Why a single map keyed by genesis:
 *
 *   One PAPI client per genesis hash. Prevents in-flight chainHead events
 *   from a destroyed client corrupting a new client's block tree. Mirrors
 *   the pattern in `w3s-conference-app/packages/shared/host/client.ts`.
 */

import { createPapiProvider } from "@novasamatech/host-api-wrapper";
import { getWsProvider } from "@polkadot-api/ws-provider";
import { createClient, type PolkadotClient } from "polkadot-api";

const clientCache = new Map<`0x${string}`, PolkadotClient>();

/**
 * Get or create a PAPI client for a given chain genesis hash. Subsequent
 * calls with the same genesis return the cached client.
 *
 * Transport:
 *   - `"auto"` (default): host mode routes through `createPapiProvider`
 *     (required on mobile, where the sandboxed iframe can't open arbitrary
 *     WSS sockets); standalone mode opens a direct WS to `wsFallback`.
 *   - `"ws"`: ALWAYS open a direct WS to `wsFallback`, even in host. Use this
 *     for chains where the host's `createPapiProvider` advertises support but
 *     does not establish a working chainHead follow — on Paseo Asset Hub Next
 *     that makes `signSubmitAndWatch` broadcast (the tx lands) yet never emit
 *     `txBestBlocksState`, so the write hangs at "broadcasting". Signing still
 *     goes through the host product-account signer; only chain RPC bypasses
 *     the host. (This is exactly what the working t3rminal app does for this
 *     chain — see `apps/t3rminal-v1/lib/host/provider.ts`.) NOTE: a `"ws"`
 *     client cannot run inside a mobile sandbox that blocks WSS.
 */
export function getOrCreateClient(
  genesis: `0x${string}`,
  wsFallback: string,
  inHost: () => boolean,
  transport: "auto" | "ws" = "auto",
): PolkadotClient {
  let client = clientCache.get(genesis);
  if (!client) {
    const provider =
      transport === "ws" || !inHost() ? getWsProvider(wsFallback) : createPapiProvider(genesis);
    client = createClient(provider);
    clientCache.set(genesis, client);
  }
  return client;
}

/** Test / HMR only — drop all cached clients so the next call rebuilds. */
export function resetClientCache(): void {
  clientCache.forEach((client) => client.destroy());
  clientCache.clear();
}

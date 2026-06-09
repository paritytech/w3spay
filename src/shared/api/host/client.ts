// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * PAPI client cache, keyed by genesis hash, shared by every product
 * talking to a Polkadot chain through `polkadot-api`.
 *
 * In host: `createPapiProvider(genesis, wsFallback)` routes JSON-RPC
 * through the host bridge (required on mobile, where the sandboxed iframe
 * can't open WSS); when the host doesn't advertise the chain the SDK falls
 * through to the WS provider rather than returning a dead provider that
 * silently hangs. Standalone: direct WSS — `createPapiProvider` throws
 * outside a host product env, so the `!inHost()` guard picks WS directly.
 *
 * The host-detection predicate is passed in by the caller (not imported
 * from `./connection.ts`) so the cache stays mockable in tests.
 *
 * One client per genesis prevents in-flight chainHead events from a
 * destroyed client corrupting a new client's block tree.
 */

import { createPapiProvider } from "@novasamatech/host-api-wrapper";
import { getWsProvider } from "@polkadot-api/ws-provider";
import { createClient, type PolkadotClient } from "polkadot-api";

const clientCache = new Map<`0x${string}`, PolkadotClient>();

export type HostEnvironmentPredicate = () => boolean;
export type ClientTransportMode = "auto" | "ws";

/**
 * Get or create a PAPI client for a genesis hash; cached per genesis.
 *
 * Transport:
 *   - `"auto"` (default): host mode routes through `createPapiProvider`
 *     with WS as fallback (an unadvertised chain degrades to direct WS);
 *     standalone opens direct WS (createPapiProvider can't be called there).
 *   - `"ws"`: ALWAYS direct WS, even in host. For chains where the host
 *     advertises support but does not establish a working chainHead follow
 *     — on Paseo Asset Hub Next that makes `signSubmitAndWatch` broadcast
 *     (the tx lands) yet never emit `txBestBlocksState`, so the write hangs
 *     at "broadcasting". Signing still goes through the host signer; only
 *     chain RPC bypasses the host. NOTE: a `"ws"` client cannot run inside
 *     a mobile sandbox that blocks WSS.
 */
export function getOrCreateClient(
  genesis: `0x${string}`,
  wsFallback: string,
): PolkadotClient {
  let client = clientCache.get(genesis);
  if (!client) {
    const ws = getWsProvider(wsFallback);
    const provider =  createPapiProvider(genesis, ws);
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

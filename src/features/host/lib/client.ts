/**
 * PAPI client wrappers for w3spay.
 *
 * Thin composition over `@/sdk`'s `getOrCreateClient` cache. The
 * shared cache is keyed by genesis hash, so w3spay and w3spay-admin in
 * the same bundle would share clients — both apps build separately, so
 * in practice each ships its own cache. `isInHost` is forwarded from
 * `./host-connection.ts` so tests can mock the local module to flip
 * provider strategy without reaching into the shared package.
 *
 * `useAssetHubClient` / `usePeopleClient` return `{ client, unsafeApi }`.
 * Despite the `use` prefix these are NOT React hooks — they're
 * process-wide singleton getters named for symmetry with the
 * conference-app and w3spay-admin codebases.
 *
 * **Forced WS-direct (`transport: "ws"`)**: the host's
 * `createPapiProvider` advertises support for Paseo Asset Hub Next but
 * does NOT establish a working `chainHead follow` (PAPI's `chainHead_v1_follow`
 * times out; `signSubmitAndWatch` broadcasts but `txBestBlocksState` never
 * arrives and the write hangs at "broadcasting"). Going straight to the
 * public WS gives PAPI a working follow so tx tracking resolves. Signing
 * still routes through the host product-account signer (see
 * `useProductAccount`); only chain RPC bypasses the host. Mirrors
 * `w3spay-admin/src/lib/host/client.ts` and the working t3rminal app.
 *
 * NOTE: a `"ws"` client cannot run inside a mobile sandbox that blocks
 * WSS outbound; the iOS host is expected to allowlist this endpoint. On
 * hosts that can't reach the public WS the PAPI client will surface
 * the underlying WS error — the host-wallet snapshot exposes it through
 * `state.kind === "error"`.
 */

import {
  getOrCreateClient,
  resetClientCache,
  resolveNetwork,
} from "@/shared/api/host";

import { envConfig } from "@/shared/config.ts";

/**
 * Get (or create) the shared main-chain PAPI client. Idempotent;
 * underlying client is cached by genesis hash.
 */
export function useAssetHubClient() {
  const network = resolveNetwork(envConfig.chain.network);
  const genesis = network.mainChain.genesisHash as `0x${string}`;
  const client = getOrCreateClient(genesis, network.mainChain.wsUrl);
  return {
    client,
    unsafeApi: client.getUnsafeApi(),
  };
}

/**
 * Get (or create) the PAPI client for the configured People-system
 * parachain (Paseo Individuality on paseo-next-v2). Returns `null` when
 * the active network has no people chain — callers (e.g. CASH balance
 * lookup) must guard.
 */
export function usePeopleClient() {
  const network = resolveNetwork(envConfig.chain.network);
  const people = network.mainChain;
  if (!people || people.genesisHash === "") return null;
  const client = getOrCreateClient(
    people.genesisHash as `0x${string}`,
    people.wsUrl
  );
  return {
    client,
    unsafeApi: client.getUnsafeApi(),
  };
}

/** Test / HMR only — drop all cached clients so the next call rebuilds. */
export const resetMainClient = resetClientCache;

/**
 * Original WS endpoint for back-compat. Read sites that still want the
 * raw endpoint string get the same value they used to; the underlying
 * provider is now WS-direct in both host and standalone mode (see the
 * file-level note above for the rationale).
 */
export const PASEO_ASSET_HUB_WS =
  resolveNetwork(envConfig.chain.network).mainChain.wsUrl;

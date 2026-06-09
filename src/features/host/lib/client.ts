// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * PAPI client wrappers for w3spay. Thin composition over the shared
 * `getOrCreateClient` cache (keyed by genesis hash). `isInHost` is forwarded
 * from the shared module so tests can mock it to flip provider strategy.
 *
 */

import {
  getOrCreateClient,
  resetClientCache,
  resolveNetwork,
} from "@/shared/api/host";

import { envConfig } from "@/config";


export function useAssetHubClient() {
  const network = resolveNetwork(envConfig.chain.network);
  const genesis = network.mainChain.genesisHash as `0x${string}`;
  const client = getOrCreateClient(genesis, network.mainChain.wsUrl);
  return {
    client,
    unsafeApi: client.getUnsafeApi(),
  };
}


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

export const resetMainClient = resetClientCache;

export const PASEO_ASSET_HUB_WS =
  resolveNetwork(envConfig.chain.network).mainChain.wsUrl;

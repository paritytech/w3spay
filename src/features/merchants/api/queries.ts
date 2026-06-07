/**
 * Load the merchant table once at boot, as a TanStack Query.
 *
 * When the on-chain read fails and no cached snapshot is available, the
 * query throws and TanStack retries every `registryRetryIntervalMs` (5 s)
 * for up to `registryRetryBudgetMs` (2 min). On success the table is
 * cached forever (`staleTime: Infinity`). After the budget expires with no
 * data, `useMerchantTable` returns `{ table: {}, source: "empty", failed: true }`
 * and the StaleMerchantsBanner surfaces.
 *
 * Cache hit / version-match: if the local KvStore snapshot is fresh enough
 * to satisfy the chain's registry version, the query resolves immediately on
 * first run from cache — no retry needed.
 *
 * Dry-run origin: registry reads always run under the configured mapped
 * read-only sentinel. Host product accounts are not guaranteed to be mapped
 * in pallet-revive; using them for view calls can fail with
 * `Revive.AccountUnmapped`.
 */

import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";


import type { MerchantTable } from "@/features/merchants/types.ts";
import {
  loadMerchants,
  type LoadMerchantsSource,
} from "@/features/merchants/lib/load-merchants.ts";
import { useAssetHubClient } from "@/features/host/lib/client.ts";
import { getTerminalStore } from "@/features/host/lib/terminal-store.ts";
import { merchantKeys } from "@/features/merchants/api/keys.ts";
import { envConfig } from "@/shared/config.ts";

export interface MerchantTableState {
  readonly table: MerchantTable | null;
  readonly source: LoadMerchantsSource | null;
  /** True once all retry attempts are exhausted with no data. */
  readonly failed: boolean;
}

/**
 * Registry dry-run origin. Keep this as the known mapped read-only sentinel.
 * `getVersion()` and row enumeration are public reads, so switching to the
 * host product account only adds a pallet-revive mapping requirement.
 */
export function merchantDryRunOrigin(readOnlyOrigin: string): string {
  return readOnlyOrigin;
}

interface LoadedMerchants {
  readonly table: MerchantTable;
  readonly source: LoadMerchantsSource;
}

/**
 * Shared query options for the merchant directory at a given dry-run
 * `origin`. Used by `useMerchantTable` for the boot read and by the scan
 * flow's `ensureQueryData` so a decode that arrives before the table
 * loads awaits the same cache entry instead of issuing a second read.
 */
export function merchantTableQueryOptions(origin: string) {
  const { merchant, contracts } = envConfig;
  const registryAddress = contracts.merchantRegistryAddress;
  const retryCount = Math.ceil(merchant.registryRetryBudgetMs / merchant.registryRetryIntervalMs);
  return queryOptions({
    queryKey: merchantKeys.table(origin),
    queryFn: async (): Promise<LoadedMerchants> => {
      // `useAssetHubClient` is a cached singleton getter, not a React hook
      // (see `host/client.ts`); safe to call here.
      const client = useAssetHubClient().client;
      console.log("[w3spay/merchants] loading merchant table", { origin, registryAddress });
      try {
        const result = await loadMerchants({
          registryAddress,
          client,
          origin,
          store: getTerminalStore(),
          onWarn: (message, error) =>
            console.warn(`[w3spay/merchants] ${message}`, error),
        });
        console.info("[w3spay/merchants] table loaded", {
          count: Object.keys(result.table).length,
          source: result.source,
          registryVersion: result.registryVersion?.toString(),
          origin,
        });
        console.info(result.table);
        // When the registry is configured and the chain + cache both came back
        // empty, throw so TanStack retries. Dev/standalone (no registry address
        // or no client) returns empty as a terminal success — no retry.
        if (result.source === "empty" && registryAddress.length > 0) {
          throw new Error("[w3spay/merchants] registry unreachable; will retry");
        }
        return { table: result.table, source: result.source };
      } catch (caught) {
        // Re-throw everything so TanStack's retry loop handles it.
        if (caught instanceof Error && caught.message.startsWith("[w3spay/merchants]")) {
          throw caught;
        }
        console.error("[w3spay/merchants] could not resolve any merchant table", caught);
        throw caught;
      }
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: (count) => count < retryCount,
    retryDelay: merchant.registryRetryIntervalMs,
  });
}

export function useMerchantTable(): MerchantTableState {
  const origin = merchantDryRunOrigin(envConfig.chain.readOnlyOrigin);

  const query = useQuery({
    ...merchantTableQueryOptions(origin),
    placeholderData: keepPreviousData,
  });

  if (query.isError && query.data == null) {
    return { table: {}, source: "empty", failed: true };
  }
  return { ...query.data ?? { table: null, source: null }, failed: false };
}

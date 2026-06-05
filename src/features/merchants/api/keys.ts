/**
 * Merchants-feature query keys.
 *
 * Read by `useMerchantTable` / `merchantTableQueryOptions` and by the
 * scan flow's `ensureQueryData` so both observers share one cache entry.
 */

export const merchantKeys = {
  /**
   * On-chain merchant directory. Keyed by the dry-run origin so the
   * sentinel→product-account flip re-reads under the right origin.
   */
  table: (origin: string) => ["merchant-table", origin] as const,
} as const;

/**
 * Shared merchant-table types.
 *
 * Lives in its own module so both the chain reader (`./onchain-loader.ts`)
 * and the top-level resolution pipeline (`./load-merchants.ts`) can
 * depend on a single source of truth without a circular import.
 *
 * The `MerchantTable` is keyed by `identityKey(merchantId, terminalId)`
 * — see `contract/load-merchants.ts`. The kassenSerial-keyed bundled
 * fallback that lived alongside this type has been removed; merchant
 * identity now arrives via the scan payload (t3rminal-issued deeplink),
 * destination + name come from the on-chain registry.
 */

import type { MerchantDestination } from "@/features/merchants/lib/destination.ts";
import type { MerchantLifecycle } from "@/features/merchants/lib/onchain-loader.ts";

export interface MerchantEntry {
  merchantId: string;
  terminalId: string;
  destination: MerchantDestination;
  displayName: string;
  /**
   * Lifecycle: `"active"` is payable, `"paused"` is registered but
   * temporarily disabled. Revoked merchants are filtered out by the
   * loader and never appear in the table.
   */
  status: MerchantLifecycle;
  /** ISO-8601. Captured from the on-chain `addedAt` (unix seconds). */
  addedAt: string;
}

export type MerchantTable = Record<string, MerchantEntry>;

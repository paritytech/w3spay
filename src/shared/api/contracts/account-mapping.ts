/**
 * Mapped-account check for pallet-revive.
 *
 * Two-step:
 *   1. `ReviveApi.address(ss58)` derives the H160 the pallet would assign.
 *   2. `Revive.OriginalAccount[h160]` is set iff `map_account` has run.
 *
 * Any failure — including a read that stalls past `MAPPING_READ_TIMEOUT_MS`
 * — is treated as unmapped: the caller then submits a standalone
 * `Revive.map_account` extrinsic before the call. A false-negative here is
 * harmless: `map_account` errors `AccountAlreadyMapped`, which `writeContract`
 * swallows. Bounding the reads keeps a flaky RPC from freezing the write at
 * the "preparing" stage forever.
 */

import type { PolkadotClient } from "polkadot-api";

import { reviveApi } from "./read.ts";
import { withTimeout } from "./with-timeout.ts";

const MAPPING_READ_TIMEOUT_MS = 10_000;

/**
 * Narrow view of `client.getUnsafeApi().query.Revive.OriginalAccount`.
 * Kept local because no one outside this module reads from that storage
 * entry directly.
 */
interface ReviveOriginalAccountQuery {
  readonly Revive?: {
    readonly OriginalAccount?: {
      getValue(key: string): Promise<unknown>;
    };
  };
}

export async function isAccountMapped(
  client: PolkadotClient,
  walletAddress: string,
): Promise<boolean> {
  const unsafeApi = client.getUnsafeApi();
  try {
    const h160 = await withTimeout(
      reviveApi(unsafeApi).address(walletAddress),
      MAPPING_READ_TIMEOUT_MS,
      "ReviveApi.address",
    );
    if (h160 == null) return false;

    const query = (unsafeApi as { query: ReviveOriginalAccountQuery }).query;
    const entry = query.Revive?.OriginalAccount?.getValue(h160);
    if (entry == null) return false;

    const original = await withTimeout(
      entry,
      MAPPING_READ_TIMEOUT_MS,
      "Revive.OriginalAccount",
    );
    return original != null;
  } catch {
    return false;
  }
}

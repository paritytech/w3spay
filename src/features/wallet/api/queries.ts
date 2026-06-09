// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Read-side wallet hooks — TanStack Queries over the local KvStore backing the
 * saved-receipts list and the id-addressed receipt detail route. The save
 * mutation invalidates this key, so a fresh write shows up without manual refresh.
 */

import { useQuery } from "@tanstack/react-query";

import { readReceipts, type ReceiptRecord } from "@/features/wallet/api/receipts.ts";
import { getTerminalStore } from "@/features/host/lib/terminal-store.ts";
import { walletKeys } from "@/features/wallet/api/keys.ts";

/** Newest-first saved `t3rminal-receipt` list. */
export function useReceipts() {
  return useQuery<ReceiptRecord[]>({
    queryKey: walletKeys.receipts(),
    queryFn: () => readReceipts(getTerminalStore()),
    staleTime: 10_000,
  });
}

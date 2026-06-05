/**
 * Process-wide W3SPay `KvStore` singleton.
 *
 * Replaces the former `useTerminalStore` ref hook: the store is plain
 * client state with no React lifecycle, so a module singleton is both
 * simpler and strictly more idempotent — every reader (query fns,
 * mutations, the scan/pay actions) shares one instance, and there is no
 * ref-population race on first render.
 *
 * Backed by `localStorage` with an in-memory fallback (see
 * `createTerminalStore`). Used for receipt idempotency keys and the
 * on-chain merchant cache envelope; canonical payment state lives in the
 * host's vault, not here.
 */

import { createTerminalStore, type KvStore } from "@/shared/utils/kv-store.ts";

let store: KvStore | null = null;

/** The shared W3SPay-scoped store. Created on first access. */
export function getTerminalStore(): KvStore {
  store ??= createTerminalStore("w3spay");
  return store;
}

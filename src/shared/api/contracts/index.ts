/**
 * `@/sdk/contracts` — generic pallet-revive contract helpers.
 *
 * Each top-level helper takes a `PolkadotClient` as its first positional
 * argument so the same module can drive any chain. Caller responsibility:
 * pass the same client instance across helpers that need to coordinate
 * (e.g. `readContract` for the inclusion oracle of a `writeContract` —
 * the underlying `getOrCreateClient` cache keyed by genesis hash makes
 * this automatic at the app layer).
 *
 *   - `./read`              — `readContract` + `reviveApi`/`stringifyResultValue`
 *   - `./write`             — barrel re-export of `writeContract`
 *                             and `watchTransaction` for callers that don't
 *                             want to choose between subpaths
 *   - `./write-contract`    — `writeContract`: dry-run, optional `map_account`
 *                             pre-step, submit + watch
 *   - `./watch-transaction` — `watchTransaction`: best-block resolver with
 *                             optional `waitForChainEffect` polling for chains
 *                             whose host bridge doesn't deliver `txBestBlocksState`
 *   - `./account-mapping`   — `isAccountMapped`: cheap pre-check that
 *                             decides whether `writeContract` must prepend
 *                             a standalone `Revive.map_account`
 *   - `./multicall`         — `batchRead`: aggregate N reads through
 *                             Multicall3 with a sequential fallback when no
 *                             Multicall3 is deployed for the chain
 *   - `./types`             — `ReviveCallDryRun`, `WeightV2`, `ReviveApiShim`
 *                             (the structural shapes the helpers cast into)
 */

export {
  reviveApi,
  readContract,
  stringifyResultValue,
  type ReadContractOptions,
} from "./read.ts";

export type { ReviveCallDryRun, WeightV2 } from "./types.ts";

export {
  writeContract,
  type WriteContractOptions,
} from "./write-contract.ts";

export {
  watchTransaction,
  type ChainEffectOracle,
  type TxStatus,
  type WatchableTx,
  type WatchTransactionOptions,
} from "./watch-transaction.ts";

export { isAccountMapped } from "./account-mapping.ts";

export {
  batchRead,
  type BatchReadOptions,
  type ReadCall,
} from "./multicall.ts";

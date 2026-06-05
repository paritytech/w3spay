/**
 * Barrel re-export for the contract write surface.
 *
 * Importers that don't want to choose between `write-contract.ts` and
 * `watch-transaction.ts` get both through this single entry. Mirrors the
 * old `@lib/contract/write.ts` shape the w3spay-admin and w3spay apps
 * imported under their previous local copies, so call sites only need to
 * change the package prefix.
 */

export { writeContract, type WriteContractOptions } from "./write-contract.ts";
export {
  watchTransaction,
  type ChainEffectOracle,
  type TxStatus,
  type WatchableTx,
  type WatchTransactionOptions,
} from "./watch-transaction.ts";

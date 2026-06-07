/**
 * Generic contract write helper over pallet-revive.
 *
 * `writeContract` runs a `ReviveApi.call(...)` dry-run for gas estimation,
 * then submits `pallet_revive::call` — preceded by a standalone
 * `Revive.map_account` extrinsic when the wallet is not yet mapped — and
 * watches it through finalization.
 *
 * Telemetry is intentionally NOT wired here. Callers that want to capture
 * dry-run exceptions or span the submission can wrap the call from the
 * outside (the dry-run path still `console.warn`s so a captured console
 * handler still sees it).
 */

import { Interface, type InterfaceAbi } from "ethers";
import { Binary, type PolkadotClient, type PolkadotSigner } from "polkadot-api";

import { isAccountMapped } from "./account-mapping.ts";
import { reviveApi, stringifyResultValue } from "./read.ts";
import {
  watchTransaction,
  type ChainEffectOracle,
  type TxStatus,
  type WatchableTx,
} from "./watch-transaction.ts";
import { withTimeout } from "./with-timeout.ts";

/**
 * Narrowed view of `client.getUnsafeApi().tx.Revive`. PAPI v2 types `.tx`
 * pallets as `unknown`; this shim is the cast boundary.
 */
interface ReviveTxShim {
  call(params: {
    dest: string;
    value: bigint;
    weight_limit: { ref_time: bigint; proof_size: bigint };
    storage_deposit_limit: bigint;
    data: Uint8Array;
  }): WatchableTx;
  map_account(): WatchableTx;
}

function reviveTx(unsafeApi: unknown): ReviveTxShim {
  return (unsafeApi as { tx: { Revive: ReviveTxShim } }).tx.Revive;
}

/**
 * `Revive.map_account` errors `AccountAlreadyMapped` when the origin is
 * already mapped. That's benign here (a racy `isAccountMapped` read), so
 * callers treat it as success and proceed to the contract call.
 */
function isAlreadyMappedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /AccountAlreadyMapped/i.test(message);
}

function formatParsedErrorArg(value: unknown): string {
  return typeof value === "bigint" ? value.toString() : String(value);
}

function decodeDryRunRevertReason(
  iface: Interface,
  data: `0x${string}`,
): string | null {
  if (data === "0x") return null;

  try {
    const parsed = iface.parseError(data);
    if (parsed != null) {
      if (parsed.name === "Error" && parsed.args.length === 1) {
        return String(parsed.args[0]);
      }
      const args = Array.from(parsed.args, formatParsedErrorArg).join(", ");
      return args === "" ? parsed.name : `${parsed.name}(${args})`;
    }
  } catch {
    // Fall through to the raw data fallback below.
  }

  return null;
}

function dryRunRevertMessage(
  iface: Interface,
  functionName: string,
  data: Uint8Array,
): string {
  const revertHex = Binary.toHex(data) as `0x${string}`;
  const reason = decodeDryRunRevertReason(iface, revertHex);
  if (reason != null && reason !== "") {
    return `contract ${functionName} dry-run reverted: ${reason}`;
  }
  return revertHex === "0x"
    ? `contract ${functionName} dry-run reverted`
    : `contract ${functionName} dry-run reverted (data=${revertHex})`;
}

/**
 * Headroom applied to dry-run outputs before they become real tx limits.
 *
 *  - **weight** (ref_time + proof_size): runtime benchmarks already carry
 *    margin; real-world variance vs dry-run is < 10%. 1.5× covers a runtime
 *    upgrade landing between simulation and submission.
 *  - **storage_deposit**: byte-deterministic. 1.25× is cheap cover for
 *    concurrent writes touching the same slot.
 */
const WEIGHT_MULTIPLIER_NUM = 3n;
const WEIGHT_MULTIPLIER_DEN = 2n;
const STORAGE_MULTIPLIER_NUM = 5n;
const STORAGE_MULTIPLIER_DEN = 4n;

/** Conservative storage deposit limit for dry-run estimation (50 DOT). */
const DRY_RUN_STORAGE_DEPOSIT = 500_000_000_000n;

/**
 * Cap the gas-estimation dry-run. A hung `ReviveApi.call` (RPC stall)
 * would otherwise freeze the write at the "preparing" stage and the
 * signature prompt would never appear. On timeout we fall through to the
 * conservative FALLBACK_* limits and proceed to sign — the same path an
 * unmapped account already takes.
 */
const DRY_RUN_TIMEOUT_MS = 20_000;

/**
 * Last-resort weight + storage limits when the dry-run can't run (unmapped
 * account — pallet-revive rejects the runtime API with `AccountUnmapped`
 * and a synthetic stand-in has no balance to cover storage deposits during
 * simulation).
 */
const FALLBACK_WEIGHT_LIMIT = { ref_time: 500_000_000_000n, proof_size: 3_000_000n };
const FALLBACK_STORAGE_DEPOSIT = 50_000_000_000n;

export interface WriteContractOptions {
  readonly address: `0x${string}`;
  readonly abi: InterfaceAbi;
  readonly functionName: string;
  readonly args?: readonly unknown[];
  readonly value?: bigint;
  readonly signer: PolkadotSigner;
  /** SS58 wallet address — used as dry-run origin and mapping check. */
  readonly walletAddress: string;
  readonly onStatus?: (status: TxStatus) => void;
  /**
   * Optional inclusion oracle for the contract call (NOT for the
   * `Revive.map_account` pre-step, which uses `isAccountMapped`
   * internally). Polled after `broadcasted` to detect inclusion via
   * state read — workaround for chains whose host-bridge `chainHead`
   * follow never delivers `txBestBlocksState`. See `watch-transaction.ts`
   * for the rationale. Without this the UI hangs at `"broadcasting"` for
   * the watchdog window before the user gets a retryable error.
   */
  readonly waitForChainEffect?: ChainEffectOracle;
}

/**
 * Submit a state-changing contract call via `pallet_revive::call`.
 *
 * Flow:
 *   1. Mapped-check via `ReviveApi.address(ss58)` + `query.Revive.OriginalAccount`.
 *   2. Dry-run for gas + revert detection (mapped accounts only).
 *   3. Build `Revive.call(...)`; if unmapped, first submit a standalone
 *      `Revive.map_account` extrinsic (no `Utility.batch_all`).
 *   4. `watchTransaction` resolves on best-block inclusion, signals finalized.
 */
export async function writeContract(
  client: PolkadotClient,
  options: WriteContractOptions,
): Promise<`0x${string}`> {
  const {
    address,
    abi,
    functionName,
    args = [],
    value,
    signer,
    walletAddress,
    onStatus,
  } = options;

  onStatus?.("preparing");

  const iface = new Interface(abi);
  const calldata = iface.encodeFunctionData(functionName, args) as `0x${string}`;
  const unsafeApi = client.getUnsafeApi();
  const destLower = address.toLowerCase() as `0x${string}`;
  const txValue = value ?? 0n;

  const isMapped = await isAccountMapped(client, walletAddress);

  // Dry-run is only viable for already-mapped accounts: pallet-revive rejects
  // unmapped SS58 origins with `AccountUnmapped`, and an EVM-derived stand-in
  // holds no balance to cover storage deposits during simulation. Unmapped
  // callers fall through to FALLBACK_* below.
  let weightLimit: { ref_time: bigint; proof_size: bigint } | undefined;
  let storageDepositLimit: bigint | undefined;
  let dryRunRevertError: string | null = null;
  if (isMapped) {
    try {
      const dryRun = await withTimeout(
        reviveApi(unsafeApi).call(
          walletAddress,
          destLower,
          txValue,
          undefined,
          DRY_RUN_STORAGE_DEPOSIT,
          Binary.fromHex(calldata),
        ),
        DRY_RUN_TIMEOUT_MS,
        `${functionName} dry-run`,
      );
      if (dryRun.result.success && (dryRun.result.value.flags & 1) === 0) {
        weightLimit = {
          ref_time:
            (dryRun.weight_required.ref_time * WEIGHT_MULTIPLIER_NUM) / WEIGHT_MULTIPLIER_DEN,
          proof_size:
            (dryRun.weight_required.proof_size * WEIGHT_MULTIPLIER_NUM) / WEIGHT_MULTIPLIER_DEN,
        };
        storageDepositLimit =
          dryRun.storage_deposit.value > 0n
            ? (dryRun.storage_deposit.value * STORAGE_MULTIPLIER_NUM) / STORAGE_MULTIPLIER_DEN
            : DRY_RUN_STORAGE_DEPOSIT;
      } else if (dryRun.result.success) {
        dryRunRevertError = dryRunRevertMessage(
          iface,
          functionName,
          dryRun.result.value.data,
        );
      } else {
        dryRunRevertError = `contract ${functionName} dry-run failed: ${stringifyResultValue(
          dryRun.result.value,
        )}`;
      }
    } catch (caught) {
      // Dry-run failures fall through to FALLBACK_* limits. The call still
      // succeeds at runtime in many cases, but a dry-run throw is operationally
      // interesting — usually RPC instability or a missing chain-state feature.
      // Logged here; callers that want Sentry-style capture can subscribe via
      // their own console.warn handler.
      console.warn(
        `[writeContract] ${functionName} dry-run threw; using conservative estimates:`,
        caught,
      );
    }
  }

  if (dryRunRevertError != null) {
    throw new Error(dryRunRevertError);
  }

  if (weightLimit == null || storageDepositLimit == null) {
    weightLimit = FALLBACK_WEIGHT_LIMIT;
    storageDepositLimit = FALLBACK_STORAGE_DEPOSIT;
  }

  const contractCall = reviveTx(unsafeApi).call({
    dest: destLower,
    value: txValue,
    weight_limit: weightLimit,
    storage_deposit_limit: storageDepositLimit,
    data: Binary.fromHex(calldata),
  });

  // pallet-revive rejects calls from an unmapped SS58 origin, so the first
  // write from a fresh product account MUST map it once. That is why the host
  // may show a `Revive.map_account` signature before the actual `Revive.call`;
  // subsequent writes skip this path after `OriginalAccount` exists. Keep this
  // as a standalone extrinsic (no `Utility.batch_all`) so the user sees the two
  // chain operations explicitly and we avoid nested-call signing/display bugs.
  // A racy `isAccountMapped` read may still report unmapped for an already-
  // mapped account; `map_account` then errors `AccountAlreadyMapped`, which is
  // benign — swallow it and run the call.
  if (!isMapped) {
    try {
      // `map_account`'s effect oracle is the same check that flips
      // `isMapped` itself, so chain follow being broken doesn't strand
      // us at "broadcasting" any more than the contract call does.
      await watchTransaction(
        reviveTx(unsafeApi).map_account(),
        signer,
        onStatus,
        { waitForChainEffect: () => isAccountMapped(client, walletAddress) },
      );
    } catch (caught) {
      if (!isAlreadyMappedError(caught)) throw caught;
    }
  }

  return watchTransaction(contractCall, signer, onStatus, {
    waitForChainEffect: options.waitForChainEffect,
  });
}

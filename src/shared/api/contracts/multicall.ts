/**
 * Multicall3 batching for ReviveApi.call() dry-runs.
 *
 * Folds N contract reads into a single `Multicall3.aggregate3` dry-run so
 * the RPC sees one round-trip instead of N. Each sub-call is encoded with
 * its own ABI, the aggregate is dispatched through `pallet-revive`, and
 * the returned `Result[]` is decoded per-call.
 *
 * When `options.multicallAddress` is omitted (or the zero address), the
 * helper transparently falls back to sequential `readContract` calls so
 * callers can adopt batching unconditionally.
 *
 * Constants:
 *   - `WEIGHT_LIMIT` / `STORAGE_LIMIT`: max u64 weights required for
 *     pallet-revive nested CALL frames when dry-running aggregate3.
 */

import {
  decodeFunctionResult,
  encodeFunctionData,
  type Abi,
} from "viem";
import { Binary, type PolkadotClient } from "polkadot-api";

import { readContract, reviveApi } from "./read.ts";
import type { ReviveCallDryRun } from "./types.ts";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** u64 max weights — required for pallet-revive nested CALL frames in dry-runs. */
const WEIGHT_LIMIT = {
  ref_time: 18_446_744_073_709_551_615n,
  proof_size: 18_446_744_073_709_551_615n,
} as const;
const STORAGE_LIMIT = 18_446_744_073_709_551_615n;

/**
 * Minimal Multicall3 ABI — only the `aggregate3` entry-point we use here.
 * `as const` + `satisfies Abi` so viem's encode/decode get full inference
 * for the args and return shapes below.
 */
const MULTICALL3_ABI = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const satisfies Abi;

export interface ReadCall {
  readonly address: `0x${string}`;
  readonly abi: Abi;
  readonly functionName: string;
  readonly args?: ReadonlyArray<unknown>;
}

export interface BatchReadOptions {
  /** Chain head to dry-run against. Default `"best"`. */
  readonly at?: "best" | "finalized";
  /**
   * Resolved Multicall3 deployment address. Omit or pass the zero address
   * to opt out of batching — `batchRead` then falls back to N sequential
   * `readContract` calls. Required by the SDK because no single Multicall3
   * is canonical across chains.
   */
  readonly multicallAddress?: `0x${string}`;
  /** SS58 origin for both the aggregate dry-run AND the sequential fallback. */
  readonly origin: string;
}

/**
 * Batch `calls` into a single ReviveApi.call() dry-run via Multicall3.
 *
 * Returns one decoded result per input call, in the same order. Throws if
 * Multicall3 reverts the aggregate or any sub-call fails — sub-calls use
 * `allowFailure: false` so a partial outage surfaces immediately instead
 * of silently returning malformed data.
 *
 * Falls back to N sequential `readContract` calls when `multicallAddress`
 * is omitted or the zero address.
 */
export async function batchRead(
  client: PolkadotClient,
  calls: ReadonlyArray<ReadCall>,
  options: BatchReadOptions,
): Promise<unknown[]> {
  if (calls.length === 0) return [];
  const { at, origin } = options;
  const multicall = (options.multicallAddress ?? ZERO_ADDRESS).toLowerCase() as `0x${string}`;

  // Single call: skip Multicall3 entirely — one inner dry-run is cheaper.
  if (calls.length === 1) {
    const only = calls[0]!;
    return [
      await readContract(client, {
        address: only.address,
        abi: only.abi,
        functionName: only.functionName,
        args: only.args ? [...only.args] : [],
        origin,
        at,
      }),
    ];
  }

  // Fallback: no Multicall3 deployed → sequential reads.
  if (multicall === ZERO_ADDRESS) {
    const results: unknown[] = [];
    for (const c of calls) {
      results.push(
        await readContract(client, {
          address: c.address,
          abi: c.abi,
          functionName: c.functionName,
          args: c.args ? [...c.args] : [],
          origin,
          at,
        }),
      );
    }
    return results;
  }

  // 1. Encode each sub-call's calldata under its own ABI.
  const encodedCalls = calls.map((c) => ({
    target: c.address,
    allowFailure: false,
    callData: encodeFunctionData({
      abi: c.abi,
      functionName: c.functionName,
      args: c.args ? [...c.args] : [],
    }),
  }));

  // 2. Wrap the encoded sub-calls in a single aggregate3 call.
  const outerCalldata = encodeFunctionData({
    abi: MULTICALL3_ABI,
    functionName: "aggregate3",
    args: [encodedCalls],
  });

  // 3. Dispatch the aggregate as one dry-run via the existing ReviveApi shim.
  const dryRun = (await reviveApi(client.getUnsafeApi()).call(
    origin,
    multicall,
    0n,
    WEIGHT_LIMIT,
    STORAGE_LIMIT,
    Binary.fromHex(outerCalldata),
    { at: at ?? "best" },
  )) as ReviveCallDryRun;

  if (!dryRun.result.success) {
    throw new Error("batchRead: Multicall3 dry-run returned failure");
  }
  if (dryRun.result.value.flags & 1) {
    throw new Error("batchRead: Multicall3 aggregate3 reverted");
  }

  // 4. Decode the outer Result[].
  const outerResult = decodeFunctionResult({
    abi: MULTICALL3_ABI,
    functionName: "aggregate3",
    data: Binary.toHex(dryRun.result.value.data) as `0x${string}`,
  }) as ReadonlyArray<{ readonly success: boolean; readonly returnData: `0x${string}` }>;

  if (outerResult.length !== calls.length) {
    throw new Error(
      `batchRead: Multicall3 returned ${outerResult.length} results for ${calls.length} calls`,
    );
  }

  // 5. Decode each inner result against its original ABI.
  return outerResult.map((entry, i) => {
    const call = calls[i]!;
    if (!entry.success) {
      throw new Error(
        `batchRead: call ${i} failed (${call.functionName} on ${call.address})`,
      );
    }
    return decodeFunctionResult({
      abi: call.abi,
      functionName: call.functionName,
      data: entry.returnData,
    });
  });
}

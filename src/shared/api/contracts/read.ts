/**
 * Generic contract read helper over pallet-revive.
 *
 * `readContract` runs a `ReviveApi.call(...)` dry-run against the supplied
 * chain, decodes the response with the supplied viem-compatible ABI, and
 * returns the result as a tuple. The caller owns the PAPI client (and the
 * configured chain) — this module never builds its own JSON-RPC connection.
 */

import {
  decodeFunctionResult,
  encodeFunctionData,
  type Abi,
} from "viem";
import { Binary, type PolkadotClient } from "polkadot-api";

import type { ReviveApiShim, ReviveCallDryRun } from "./types.ts";

export type { ReviveCallDryRun, WeightV2 } from "./types.ts";

export interface ReadContractOptions {
  readonly address: `0x${string}`;
  readonly abi: Abi;
  readonly functionName: string;
  readonly args?: ReadonlyArray<unknown>;
  /**
   * SS58 origin for the dry-run. Use a well-known mapped account
   * (e.g. Alice on Westend/Paseo) or an EVM-derived sentinel whose
   * AccountId32 trailer is 12 × `0xEE` (pallet-revive treats those as
   * already-mapped, so the dry-run skips the mapping check entirely).
   *
   * NOT a wallet address that may not be mapped — that errors
   * `AccountUnmapped` in the runtime API.
   */
  readonly origin: string;
  readonly at?: "best" | "finalized";
}

/**
 * Cast the opaque `unsafeApi.apis.ReviveApi` surface to the narrow shim we
 * actually call. PAPI v2 types runtime APIs as `unknown` when obtained via
 * `getUnsafeApi()`; the cast lives here so individual helpers stay clean.
 *
 * Exported because `multicall.ts` and `account-mapping.ts` need the same
 * narrow surface against the same `unsafeApi` instance.
 */
export function reviveApi(unsafeApi: unknown): ReviveApiShim {
  return (unsafeApi as { apis: { ReviveApi: ReviveApiShim } }).apis.ReviveApi;
}

/**
 * Render a runtime dry-run error value as a stable string for error
 * messages. Handles the bigint-in-payload case (`JSON.stringify` throws on
 * bare bigints) and falls back to `String(value)` for anything exotic.
 */
export function stringifyResultValue(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    return String(value);
  }
}

/**
 * Read from a revive contract via `ReviveApi.call(...)` dry-run.
 *
 * Returns the decoded result wrapped in an array so callers can use
 * consistent array-destructuring (`const [value] = await readContract(...)`)
 * regardless of whether the ABI has a single or multiple outputs.
 */
export async function readContract<T = unknown>(
  client: PolkadotClient,
  options: ReadContractOptions,
): Promise<T> {
  const { address, abi, functionName, args = [], origin, at } = options;
  const calldata = encodeFunctionData({ abi, functionName, args: args as unknown[] });
  const resolvedAt = at ?? "best";

  const dryRun: ReviveCallDryRun = await reviveApi(client.getUnsafeApi()).call(
    origin,
    address.toLowerCase(),
    0n,
    undefined,
    undefined,
    Binary.fromHex(calldata),
    { at: resolvedAt },
  );

  if (!dryRun.result.success) {
    throw new Error(
      `contract read ${functionName} failed: ${stringifyResultValue(dryRun.result.value)}`,
    );
  }

  if (dryRun.result.value.flags & 1) {
    throw new Error(`contract read ${functionName} reverted`);
  }

  const hex = Binary.toHex(dryRun.result.value.data);
  if (hex === "0x") {
    throw new Error(
      `contract read ${functionName} returned empty data; no contract was found at ${address}`,
    );
  }

  const decoded = decodeFunctionResult({ abi, functionName, data: hex as `0x${string}` });
  // viem returns scalar values directly for single-output ABIs; wrap so all
  // callers can use array destructuring uniformly:
  //   const [x] = await readContract(...);
  return (Array.isArray(decoded) ? decoded : [decoded]) as unknown as T;
}

// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Generic contract read over pallet-revive: `readContract` runs a
 * `ReviveApi.call(...)` dry-run and decodes via a viem-compatible ABI. The
 * caller owns the PAPI client and chain — this module never builds its own
 * JSON-RPC connection.
 */

import {
  decodeFunctionResult,
  encodeFunctionData,
  type Abi,
} from "viem";
import { Binary, type PolkadotClient } from "polkadot-api";

import type { ReviveApiShim, ReviveCallDryRun } from "./types.ts";

export interface ReadContractOptions {
  readonly address: `0x${string}`;
  readonly abi: Abi;
  readonly functionName: string;
  readonly args?: ReadonlyArray<unknown>;
  /**
   * SS58 origin for the dry-run. Use a well-known mapped account or an
   * EVM-derived sentinel whose AccountId32 trailer is 12 × `0xEE`
   * (pallet-revive treats those as mapped). NOT a possibly-unmapped wallet
   * address — that errors `AccountUnmapped` in the runtime API.
   */
  readonly origin: string;
  readonly at?: "best" | "finalized";
}

/**
 * Cast `unsafeApi.apis.ReviveApi` to the narrow shim — PAPI v2 types runtime
 * APIs as `unknown` via `getUnsafeApi()`. Internal to the read path.
 */
function reviveApi(unsafeApi: unknown): ReviveApiShim {
  return (unsafeApi as { apis: { ReviveApi: ReviveApiShim } }).apis.ReviveApi;
}

/**
 * Render a dry-run error value as a stable string. Handles bigint payloads
 * (`JSON.stringify` throws on bare bigints); falls back to `String(value)`.
 */
function stringifyResultValue(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    return String(value);
  }
}

/**
 * Read a revive contract via `ReviveApi.call(...)` dry-run. Result is wrapped
 * in an array so callers can array-destructure regardless of single vs
 * multiple ABI outputs.
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
  // viem returns scalars directly for single-output ABIs; wrap so callers
  // can array-destructure uniformly.
  return (Array.isArray(decoded) ? decoded : [decoded]) as unknown as T;
}

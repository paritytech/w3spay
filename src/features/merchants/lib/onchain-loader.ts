// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * On-chain merchant directory reader. The W3SPay registry on Paseo Asset
 * Hub is the single source of truth for
 * `(merchantId, terminalId) → (destination, displayName)`; this enumerates
 * the terminal keys, decodes each `MerchantEntry`, and returns rows for
 * `load-merchants.ts` to project.
 *
 * Reads go through `@/sdk/contracts`' `readContract` (shared with
 * w3spay-admin). The dry-run `origin` must be an account mapped in
 * pallet-revive.
 *
 * Version short-circuit: when `previousVersion` matches the on-chain
 * `getVersion()`, this rejects with `VersionUnchangedError` so the caller
 * keeps its cached snapshot without paying for the per-row reads.
 */

import type { PolkadotClient } from "polkadot-api";
import { readContract } from "@/shared/api/contracts";

import { W3SPayRegistryABI } from "@/features/merchants/lib/registry-abi.ts";

/** H160 (20-byte) address, 0x-prefixed, case-insensitive. */
const H160_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * One decoded on-chain row. Mirrors `IW3SPayRegistry.MerchantEntry`.
 * The destination is a 32-byte AccountId32 (Substrate, not H160), returned
 * as `bytes32 destinationAccountId` and preserved as lowercase 0x-prefixed
 * hex so `MerchantDestination.accountId32` consumes it without re-encoding.
 */
export interface ChainMerchantRow {
  merchantId: string;
  terminalId: string;
  /** 32-byte AccountId32, lowercase `0x`-prefixed hex. */
  destinationAccountId: string;
  displayName: string;
  /** Lifecycle: 0 = active, 1 = paused, 2 = revoked. */
  status: MerchantLifecycle;
  /** Unix seconds — captured at register-time. */
  addedAt: number;
  /** Unix seconds — bumped on every mutation. */
  updatedAt: number;
}

/** Mirror of the on-chain `MerchantStatus` enum — narrow so callers branch on the string, not the raw uint8. */
export type MerchantLifecycle = "active" | "paused" | "revoked";

export interface ChainOverlay {
  /** On-chain `version` at the time of the snapshot. */
  version: bigint;
  /** All rows, in chain enumeration order. */
  rows: ChainMerchantRow[];
}

export interface LoadOnChainOptions {
  /** Deployed registry contract address (H160, 0x-prefixed). */
  registryAddress: string;
  /** Paseo Asset Hub PAPI client (or a structurally-compatible mock). */
  client: PolkadotClient;
  /**
   * SS58 dry-run origin. Must be mapped in pallet-revive; unmapped accounts
   * fail with `Revive.AccountUnmapped` even for view reads.
   */
  origin: string;
  /** Last seen on-chain version. Match → loader rejects with `VersionUnchangedError` instead of fetching rows. */
  previousVersion?: bigint;
}

/** Thrown when `previousVersion` matches the chain so callers can reuse their cache. */
export class VersionUnchangedError extends Error {
  readonly version: bigint;
  constructor(version: bigint) {
    super(`registry version unchanged at ${version}`);
    this.name = "VersionUnchangedError";
    this.version = version;
  }
}

export class InvalidRegistryAddressError extends Error {
  constructor(value: string) {
    super(`registry address must be a 0x-prefixed H160; got ${value}`);
    this.name = "InvalidRegistryAddressError";
  }
}

/**
 * Read the registry overlay: version first (bail if it matches
 * `previousVersion`), then `getAllTerminalKeys()` and per-key
 * `getMerchantByKey`. Per-key reads are sequential — at pilot scale (≤10)
 * parallelizing saves nothing and the sequential path stays debuggable.
 */
export async function loadOverlayFromChain(
  options: LoadOnChainOptions,
): Promise<ChainOverlay> {
  const { registryAddress, client, origin, previousVersion } = options;
  if (!H160_PATTERN.test(registryAddress)) {
    throw new InvalidRegistryAddressError(registryAddress);
  }
  const address = registryAddress.toLowerCase() as `0x${string}`;

  const [version] = await readContract<[bigint]>(client, {
    address,
    abi: W3SPayRegistryABI,
    functionName: "getVersion",
    origin,
    at: "best",
  });

  if (previousVersion != null && previousVersion === version) {
    throw new VersionUnchangedError(version);
  }

  const keys = await readContract<readonly `0x${string}`[]>(client, {
    address,
    abi: W3SPayRegistryABI,
    functionName: "getAllTerminalKeys",
    origin,
    at: "best",
  });

  const rows: ChainMerchantRow[] = [];
  for (const key of keys) {
    const [entry] = await readContract<[RawMerchantEntry]>(client, {
      address,
      abi: W3SPayRegistryABI,
      functionName: "getMerchantByKey",
      args: [key],
      origin,
      at: "best",
    });
    if (!entry.exists) {
      // Defensive: enumeration is authoritative, but skip rather than
      // poison the whole overlay.
      continue;
    }
    rows.push({
      merchantId: entry.merchantId,
      terminalId: entry.terminalId,
      destinationAccountId: entry.destinationAccountId.toLowerCase(),
      displayName: entry.displayName,
      status: merchantStatusFromContract(entry.status),
      addedAt: Number(entry.addedAt),
      updatedAt: Number(entry.updatedAt),
    });
  }

  return { version, rows };
}


/**
 * Shape `viem`'s `decodeFunctionResult` returns for `getMerchantByKey`.
 * `destinationAccountId` is a `bytes32` (AccountId32) as lowercase 0x hex;
 * `status` is the `MerchantStatus` uint8 (0 = active, 1 = paused,
 * 2 = revoked); `addedAt`/`updatedAt` are uint64 as `bigint`.
 */
interface RawMerchantEntry {
  readonly merchantId: string;
  readonly terminalId: string;
  readonly destinationAccountId: `0x${string}`;
  readonly displayName: string;
  readonly status: number;
  readonly addedAt: bigint;
  readonly updatedAt: bigint;
  readonly exists: boolean;
}

function merchantStatusFromContract(status: number | bigint): MerchantLifecycle {
  const n = typeof status === "bigint" ? Number(status) : status;
  if (n === 0) return "active";
  if (n === 1) return "paused";
  if (n === 2) return "revoked";
  throw new Error(`unknown merchant status ${n}`);
}

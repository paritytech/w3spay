/**
 * On-chain merchant directory reader.
 *
 * The W3SPay merchant registry on Paseo Asset Hub is the single source
 * of truth for `(merchantId, terminalId) → (destination, displayName)`.
 * This module is a thin reader: it enumerates the registry's terminal
 * keys, decodes each `MerchantEntry`, and returns the result so
 * `load-merchants.ts` can project it into the identity-keyed
 * `MerchantTable` consumed by the scan path.
 *
 * Reads go through `@/sdk/contracts`' `readContract` (the same
 * helper w3spay-admin uses), so w3spay and admin share one revive
 * dry-run path. The dry-run `origin` is supplied by the caller and must be an
 * account already mapped in pallet-revive; w3spay runtime reads use the
 * configured mapped sentinel (see `load-merchants.ts`).
 *
 * Version short-circuit: when `previousVersion` is supplied and the
 * on-chain `getVersion()` matches, this module rejects with
 * `VersionUnchangedError` so the caller can keep its cached snapshot
 * without paying for the per-row reads.
 */

import type { PolkadotClient } from "polkadot-api";
import { readContract } from "@/shared/api/contracts";

import { W3SPayMerchantRegistryABI } from "@/features/merchants/lib/registry-abi.ts";

/** H160 (20-byte) address, 0x-prefixed, case-insensitive. */
const H160_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * One on-chain row decoded into a shape the loader can project into the
 * identity-keyed `MerchantTable`.
 *
 * Mirrors `IW3SPayMerchantRegistry.MerchantEntry` exactly. The
 * destination is a 32-byte AccountId32 on Substrate (not an H160) —
 * the contract returns it as `bytes32 destinationAccountId`, and we
 * preserve it as a lowercase 0x-prefixed 64-char hex string so the
 * `MerchantDestination.accountId32` payload can consume it without
 * any further encoding.
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

/**
 * Mirror of the on-chain `MerchantStatus` enum. Kept narrow so the
 * loader (and downstream UI) can branch on `status === "active"`
 * without leaking the raw uint8 representation.
 */
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
   * fail `ReviveApi.call` with `Revive.AccountUnmapped` even for view reads.
   */
  origin: string;
  /**
   * Last seen on-chain version. If the live `getVersion()` matches, the loader
   * rejects with `VersionUnchangedError` instead of fetching the rows.
   */
  previousVersion?: bigint;
}

/**
 * Sentinel error thrown when `previousVersion` matches the chain. Callers
 * should detect it explicitly and reuse their cache.
 */
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
 * Read the registry's overlay from chain.
 *
 * Strategy: pull the version first; if it matches `previousVersion`, bail.
 * Otherwise pull `getAllTerminalKeys()` and per-key `getMerchantByKey`.
 * Per-key reads are sequential — at pilot scale (≤10 entries) the marginal
 * cost of parallelizing is negligible against the per-read RPC round-trip,
 * and the sequential path keeps the loader debuggable.
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
    abi: W3SPayMerchantRegistryABI,
    functionName: "getVersion",
    origin,
    at: "best",
  });

  if (previousVersion != null && previousVersion === version) {
    throw new VersionUnchangedError(version);
  }

  const keys = await readContract<readonly `0x${string}`[]>(client, {
    address,
    abi: W3SPayMerchantRegistryABI,
    functionName: "getAllTerminalKeys",
    origin,
    at: "best",
  });

  const rows: ChainMerchantRow[] = [];
  for (const key of keys) {
    const [entry] = await readContract<[RawMerchantEntry]>(client, {
      address,
      abi: W3SPayMerchantRegistryABI,
      functionName: "getMerchantByKey",
      args: [key],
      origin,
      at: "best",
    });
    if (!entry.exists) {
      // Defensive: should never happen because the enumeration is authoritative,
      // but skip rather than poison the whole overlay if it does.
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

// ---------- internals ----------

/**
 * Shape `viem`'s `decodeFunctionResult` returns for `getMerchantByKey`'s
 * `MerchantEntry` tuple. `destinationAccountId` is a `bytes32`
 * (32-byte AccountId32) surfaced as a lowercase 0x-prefixed hex string;
 * `status` is the underlying uint8 of the `MerchantStatus` enum
 * (0 = active, 1 = paused, 2 = revoked); `addedAt`/`updatedAt` are
 * uint64 surfaced as `bigint`.
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

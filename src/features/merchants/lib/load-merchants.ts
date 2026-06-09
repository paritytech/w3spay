// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Merchant table loader. The on-chain registry is the single source of
 * truth; merchant identity arrives via the t3rminal deeplink
 * (`merchantId, terminalId`), destination + displayName from
 * `W3SPayRegistry` on Paseo Asset Hub.
 *
 * Boot resolution order: chain (read rows, cache snapshot) → cache (last
 * chain snapshot) → empty (every lookup is `unknownMerchant`). The registry
 * `version` is persisted with the cache so a returning device can
 * short-circuit the rows fetch when nothing on chain has changed.
 *
 * `MerchantTable` is keyed by `identityKey(merchantId, terminalId)` —
 * `"{merchantId}|{terminalId}"`.
 */

import type { PolkadotClient } from "polkadot-api";

import { envConfig } from "@/config";
import type { KvStore } from "@/shared/utils/kv-store.ts";
import type { MerchantEntry, MerchantTable } from "@/features/merchants/types.ts";
import {
  InvalidRegistryAddressError,
  loadOverlayFromChain,
  VersionUnchangedError,
  type ChainMerchantRow,
  type MerchantLifecycle,
} from "@/features/merchants/lib/onchain-loader.ts";

export type { MerchantEntry, MerchantTable, MerchantLifecycle };


/** Storage key for the persisted snapshot. Bumped when the schema changes. */
export const MERCHANT_CACHE_KEY = "w3spay:merchants-onchain:cached:v3";
/** Wall-clock timeout for the on-chain read before we fall back. */
export const DEFAULT_CHAIN_TIMEOUT_MS = 3_000;

/** Pinned chain ID — Paseo Asset Hub Testnet. Surfaced for diagnostics without re-deriving via PAPI. */
export const PASEO_ASSET_HUB_CHAIN_ID = 420420417;

/**
 * Build the `MerchantTable` lookup key. Lives by the loader so every
 * caller — boot, scan, refresh — agrees on the same key shape.
 */
export function identityKey(merchantId: string, terminalId: string): string {
  return `${merchantId}|${terminalId}`;
}

/** Cached snapshot envelope. Versioned in case the storage shape ever changes. */
interface CachedSnapshot {
  /** Schema version for the envelope (NOT the on-chain registry version). */
  schemaVersion: 3;
  /** On-chain `version` at the time of the snapshot. */
  registryVersion: string; // BigInt as decimal string — JSON-safe.
  /** Merged merchant table (identityKey → MerchantEntry). */
  table: MerchantTable;
}

export interface LoadMerchantsOptions {
  /**
   * Deployed registry contract address (H160, 0x-prefixed). Absent/empty
   * skips the chain step. From `VITE_W3SPAY_REGISTRY_ADDRESS` in prod.
   */
  registryAddress?: string | null;
  /** Paseo Asset Hub PAPI client (or a structurally-compatible mock). */
  client?: PolkadotClient | null;
  /**
   * SS58 dry-run origin for the revive read. Defaults to the mapped
   * read-only sentinel; custom callers must pass an already-mapped account.
   */
  origin?: string;
  /** Persistent cache. When provided, chain reads refresh it. */
  store?: KvStore | null;
  /** Override for tests. */
  timeoutMs?: number;
  /** Logger hook for diagnostics. */
  onWarn?: (message: string, error?: unknown) => void;
}

export type LoadMerchantsSource =
  | "chain"
  | "cache-version-match"
  | "cache"
  | "empty";

export interface LoadMerchantsResult {
  table: MerchantTable;
  source: LoadMerchantsSource;
  /** Present when the resolution went through the chain or cache path. */
  registryVersion?: bigint;
}

/** Load the table and return just the records. Refreshes the KvStore cache on chain-success. */
export async function loadMerchantTable(
  options: LoadMerchantsOptions,
): Promise<MerchantTable> {
  const result = await loadMerchants(options);
  return result.table;
}

/** Full result with the resolved source — useful for diagnostics in `App.tsx`. */
export async function loadMerchants(
  options: LoadMerchantsOptions,
): Promise<LoadMerchantsResult> {
  const {
    registryAddress,
    client,
    origin = envConfig.chain.readOnlyOrigin,
    store = null,
    timeoutMs = DEFAULT_CHAIN_TIMEOUT_MS,
    onWarn,
  } = options;

  const cached = await readCachedSnapshot(store, onWarn);


  // Chain read — skipped when address/client are missing so standalone dev
  //    builds work without WS.
  if (registryAddress != null && registryAddress.length > 0 && client != null) {
    try {
      const overlay = await withTimeout(
        loadOverlayFromChain({
          registryAddress,
          client,
          origin,
          previousVersion: cached?.registryVersion,
        }),
        timeoutMs,
      );
      const table = tableFromRows(overlay.rows);
      await writeCachedSnapshot(store, overlay.version, table, onWarn);
      return {
        table,
        source: "chain",
        registryVersion: overlay.version,
      };
    } catch (error) {
      if (error instanceof VersionUnchangedError && cached != null) {
        return {
          table: cached.table,
          source: "cache-version-match",
          registryVersion: error.version,
        };
      }
      if (error instanceof InvalidRegistryAddressError) {
        onWarn?.(`registry address invalid; falling back to cache/empty`, error);
      } else {
        onWarn?.("on-chain merchant fetch failed; falling back to cache/empty", error);
      }
    }
  }

  // Cache: last successful chain snapshot.
  if (cached != null) {
    return {
      table: cached.table,
      source: "cache",
      registryVersion: cached.registryVersion,
    };
  }

  // Empty — no chain, no cache. Every lookup lands on `unknownMerchant`,
  //    the correct UX for a first-boot device with an unreachable registry.
  return { table: {}, source: "empty" };
}

/**
 * Project chain rows into the identity-keyed table. The on-chain
 * destination is a 32-byte AccountId32, surfaced verbatim as
 * `MerchantDestination.accountId32` — no H160 padding needed.
 *
 * Revoked rows are dropped; paused rows are kept so the scan path can show
 * a "paused" UX (the scan-time policy lives in `stage-context.tsx`).
 */
function tableFromRows(rows: ChainMerchantRow[]): MerchantTable {
  const out: MerchantTable = {};
  for (const row of rows) {
    if (row.status === "revoked") continue;
    out[identityKey(row.merchantId, row.terminalId)] = {
      merchantId: row.merchantId,
      terminalId: row.terminalId,
      destination: { kind: "accountId32", value: row.destinationAccountId },
      displayName: row.displayName,
      status: row.status,
      // Unix seconds → ISO-8601 so the table stays string-typed and
      // JSON-trivial across the cache round-trip.
      addedAt: new Date(row.addedAt * 1000).toISOString(),
    };
  }
  return out;
}


async function readCachedSnapshot(
  store: KvStore | null,
  onWarn: LoadMerchantsOptions["onWarn"],
): Promise<{ table: MerchantTable; registryVersion: bigint } | null> {
  if (store == null) return null;
  const raw = await store.get(MERCHANT_CACHE_KEY).catch(() => null);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as CachedSnapshot;
    if (parsed.schemaVersion !== 3) return null;
    const registryVersion = BigInt(parsed.registryVersion);
    // Re-validate so a corrupt cache can't poison the runtime; anything
    // malformed drops the whole snapshot.
    const table = sanitizeCachedTable(parsed.table);
    if (table == null) return null;
    return { table, registryVersion };
  } catch (error) {
    onWarn?.("cached merchant snapshot is unreadable; ignoring", error);
    return null;
  }
}

async function writeCachedSnapshot(
  store: KvStore | null,
  registryVersion: bigint,
  table: MerchantTable,
  onWarn: LoadMerchantsOptions["onWarn"],
): Promise<void> {
  if (store == null) return;
  const snapshot: CachedSnapshot = {
    schemaVersion: 3,
    registryVersion: registryVersion.toString(),
    table,
  };
  try {
    await store.set(MERCHANT_CACHE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    onWarn?.("failed to persist merchant snapshot", error);
  }
}

/**
 * Defensive validator for a cached merchant table. Returns `null` on
 * anything untrustworthy — the caller treats that as a cache miss.
 */
function sanitizeCachedTable(raw: unknown): MerchantTable | null {
  if (raw === null || typeof raw !== "object") return null;
  const out: MerchantTable = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") return null;
    const entry = value as Partial<MerchantEntry>;
    if (
      typeof entry.merchantId !== "string" ||
      typeof entry.terminalId !== "string" ||
      typeof entry.displayName !== "string" ||
      typeof entry.addedAt !== "string" ||
      (entry.status !== "active" && entry.status !== "paused") ||
      entry.destination == null ||
      (entry.destination.kind !== "accountId32" &&
        entry.destination.kind !== "reviveContract") ||
      typeof entry.destination.value !== "string" ||
      !entry.destination.value.startsWith("0x")
    ) {
      return null;
    }
    out[key] = entry as MerchantEntry;
  }
  return out;
}


function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`on-chain merchant read timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

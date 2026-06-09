import { describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";
import { Binary, type PolkadotClient } from "polkadot-api";

import {
  loadOverlayFromChain,
  VersionUnchangedError,
  InvalidRegistryAddressError,
} from "@/features/merchants/lib/onchain-loader.ts";
import { W3SPayRegistryABI } from "@/features/merchants/lib/registry-abi.ts";
import {
  identityKey,
  loadMerchants,
  MERCHANT_CACHE_KEY,
  type LoadMerchantsOptions,
} from "@/features/merchants/lib/load-merchants.ts";
import type { KvStore } from "@/shared/utils/kv-store.ts";
import { envConfig } from "@/config";

const iface = new ethers.Interface(W3SPayRegistryABI);

const REGISTRY_ADDRESS = "0x" + "ab".repeat(20);
/**
 * Mapped read-only sentinel — the dry-run origin used when no host
 * wallet origin is supplied. Sourced from config so the test tracks the
 * default instead of freezing the literal.
 */
const READ_ONLY_ORIGIN = envConfig.chain.readOnlyOrigin;

interface MerchantRow {
  merchantId: string;
  terminalId: string;
  /** 32-byte AccountId32, 0x-prefixed hex (66 chars). */
  destinationAccountId: string;
  displayName: string;
  /** MerchantStatus enum on chain: 0 = active, 1 = paused, 2 = revoked. */
  status: 0 | 1 | 2;
  addedAt: bigint;
  updatedAt: bigint;
}

function rowKey(merchantId: string, terminalId: string): string {
  return ethers.keccak256(
    ethers.solidityPacked(["string", "string", "string"], [merchantId, "|", terminalId])
  );
}

/**
 * Build a fake PAPI client that pretends to be a deployed registry.
 * Each call routes through ethers' ABI codec the same way the real reader
 * would, so the test exercises the full encode → call → decode round-trip.
 */
function makeFakeClient(opts: {
  version: bigint;
  rows: MerchantRow[];
  succeed?: boolean;
  flags?: number;
}) {
  const { version, rows, succeed = true, flags = 0 } = opts;
  const byKey = new Map(
    rows.map((r) => [rowKey(r.merchantId, r.terminalId), r] as const),
  );
  const enumeratedKeys = rows.map((r) => rowKey(r.merchantId, r.terminalId));

  const call = vi.fn(
    async (
      _origin: string,
      _addr: `0x${string}`,
      _value: bigint,
      _gasLimit: unknown,
      _depositLimit: unknown,
      data: Uint8Array,
      _options?: { at?: "best" | "finalized" },
    ) => {
      const hex = Binary.toHex(data) as `0x${string}`;
      const parsed = iface.parseTransaction({ data: hex });
      if (parsed == null) throw new Error("could not decode calldata");

      let returnHex: `0x${string}`;
      if (parsed.name === "getVersion") {
        returnHex = iface.encodeFunctionResult("getVersion", [version]) as `0x${string}`;
      } else if (parsed.name === "getAllTerminalKeys") {
        returnHex = iface.encodeFunctionResult("getAllTerminalKeys", [
          enumeratedKeys,
        ]) as `0x${string}`;
      } else if (parsed.name === "getMerchantByKey") {
        const [k] = parsed.args;
        const row = byKey.get(k as string);
        const entry = row != null
          ? {
              merchantId: row.merchantId,
              terminalId: row.terminalId,
              destinationAccountId: row.destinationAccountId,
              displayName: row.displayName,
              status: row.status,
              addedAt: row.addedAt,
              updatedAt: row.updatedAt,
              exists: true,
            }
          : {
              merchantId: "",
              terminalId: "",
              destinationAccountId: "0x" + "00".repeat(32),
              displayName: "",
              status: 0,
              addedAt: 0n,
              updatedAt: 0n,
              exists: false,
            };
        returnHex = iface.encodeFunctionResult("getMerchantByKey", [entry]) as `0x${string}`;
      } else {
        throw new Error(`unexpected function: ${parsed.name}`);
      }

      if (!succeed) {
        return { result: { success: false, value: { revert: "boom" } } };
      }
      return {
        result: {
          success: true,
          value: { data: Binary.fromHex(returnHex), flags },
        },
      };
    },
  );

  return {
    getUnsafeApi: () => ({ apis: { ReviveApi: { call } } }),
    call,
  } as unknown as PolkadotClient & { call: typeof call };
}

function makeMemoryStore(initial: Record<string, string> = {}): KvStore & {
  raw: Map<string, string>;
} {
  const raw = new Map(Object.entries(initial));
  return {
    raw,
    async get(key) {
      return raw.has(key) ? raw.get(key)! : null;
    },
    async set(key, value) {
      raw.set(key, value);
    },
    async remove(key) {
      raw.delete(key);
    },
    async getJSON<T>(key: string) {
      const v = raw.get(key);
      if (v == null) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return null;
      }
    },
    async setJSON(key, value) {
      raw.set(key, JSON.stringify(value));
    },
  };
}

// ---------- loadOverlayFromChain ----------

describe("loadOverlayFromChain", () => {
  it("decodes every row from the registry", async () => {
    const destFunkhaus = "0x" + "11".repeat(32);
    const destBookshop = "0x" + "22".repeat(32);
    const client = makeFakeClient({
      version: 4n,
      rows: [
        {
          merchantId: "funkhaus",
          terminalId: "bar-east-01",
          destinationAccountId: destFunkhaus,
          displayName: "Bar East",
          status: 0,
          addedAt: 1_700_000_000n,
          updatedAt: 1_700_000_100n,
        },
        {
          merchantId: "demo-bookshop",
          terminalId: "till-01",
          destinationAccountId: destBookshop,
          displayName: "Demo Bookshop",
          status: 1,
          addedAt: 1_700_000_001n,
          updatedAt: 1_700_000_001n,
        },
      ],
    });

    const overlay = await loadOverlayFromChain({
      registryAddress: REGISTRY_ADDRESS,
      client,
      origin: READ_ONLY_ORIGIN,
    });

    expect(overlay.version).toBe(4n);
    expect(overlay.rows.map((r) => r.merchantId)).toEqual([
      "funkhaus",
      "demo-bookshop",
    ]);
    const [funk, book] = overlay.rows;
    expect(funk!.destinationAccountId).toBe(destFunkhaus);
    expect(funk!.status).toBe("active");
    expect(funk!.addedAt).toBe(1_700_000_000);
    expect(funk!.updatedAt).toBe(1_700_000_100);
    expect(book!.destinationAccountId).toBe(destBookshop);
    expect(book!.status).toBe("paused");
  });

  it("short-circuits when previousVersion matches", async () => {
    const client = makeFakeClient({ version: 9n, rows: [] });
    await expect(
      loadOverlayFromChain({
        registryAddress: REGISTRY_ADDRESS,
        client,
        origin: READ_ONLY_ORIGIN,
        previousVersion: 9n,
      }),
    ).rejects.toBeInstanceOf(VersionUnchangedError);
    // Only the version call should have run — not getAllTerminalKeys.
    expect(client.call).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid registry address", async () => {
    const client = makeFakeClient({ version: 1n, rows: [] });
    await expect(
      loadOverlayFromChain({
        registryAddress: "0xshort",
        client,
        origin: READ_ONLY_ORIGIN,
      }),
    ).rejects.toBeInstanceOf(InvalidRegistryAddressError);
  });

  it("surfaces a failed dry-run as a readable error", async () => {
    const client = makeFakeClient({ version: 1n, rows: [], succeed: false });
    await expect(
      loadOverlayFromChain({
        registryAddress: REGISTRY_ADDRESS,
        client,
        origin: READ_ONLY_ORIGIN,
      }),
    ).rejects.toThrow(/failed.*boom/);
  });

  it("matches admin's lower-case H160 and best-block read shape", async () => {
    const client = makeFakeClient({ version: 1n, rows: [] });
    await loadOverlayFromChain({
      registryAddress: "0x" + "AB".repeat(20),
      client,
      origin: READ_ONLY_ORIGIN,
    });

    for (const call of client.call.mock.calls) {
      expect(call[1]).toBe(REGISTRY_ADDRESS);
      expect(call[0]).toBe(READ_ONLY_ORIGIN);
      expect(call[6]).toEqual({ at: "best" });
    }
  });

  it("treats successful dry-runs with revert flags as reverts", async () => {
    const client = makeFakeClient({ version: 1n, rows: [], flags: 1 });
    await expect(
      loadOverlayFromChain({
        registryAddress: REGISTRY_ADDRESS,
        client,
        origin: READ_ONLY_ORIGIN,
      }),
    ).rejects.toThrow(/reverted/);
  });
});

// ---------- identityKey ----------

describe("identityKey", () => {
  it("joins merchantId and terminalId with a pipe", () => {
    expect(identityKey("funkhaus", "bar-east-01")).toBe("funkhaus|bar-east-01");
  });

  it("does not normalise — different cases hash to different keys", () => {
    expect(identityKey("Funkhaus", "bar-east-01")).not.toBe(
      identityKey("funkhaus", "bar-east-01"),
    );
  });
});

// ---------- end-to-end via loadMerchants ----------

describe("loadMerchants — chain integration", () => {
  it("chain-success: projects rows into the identity-keyed table and caches the snapshot", async () => {
    const store = makeMemoryStore();
    const onChainDestination = "0x" + "22".repeat(32);
    const client = makeFakeClient({
      version: 1n,
      rows: [
        {
          merchantId: "funkhaus",
          terminalId: "bar-east-01",
          destinationAccountId: onChainDestination,
          displayName: "Bar East (chain)",
          status: 0,
          addedAt: 1_700_000_000n,
          updatedAt: 1_700_000_000n,
        },
      ],
    });

    const opts: LoadMerchantsOptions = {
      registryAddress: REGISTRY_ADDRESS,
      client,
      store,
    };
    const result = await loadMerchants(opts);
    expect(result.source).toBe("chain");
    expect(result.registryVersion).toBe(1n);

    const key = identityKey("funkhaus", "bar-east-01");
    expect(result.table[key]).toEqual({
      merchantId: "funkhaus",
      terminalId: "bar-east-01",
      destination: {
        kind: "accountId32",
        value: onChainDestination,
      },
      displayName: "Bar East (chain)",
      status: "active",
      addedAt: "2023-11-14T22:13:20.000Z",
    });

    const snapshot = JSON.parse(store.raw.get(MERCHANT_CACHE_KEY)!);
    expect(snapshot.schemaVersion).toBe(3);
    expect(snapshot.registryVersion).toBe("1");
    expect(snapshot.table[key].destination.value).toBe(onChainDestination);
    expect(snapshot.table[key].status).toBe("active");
  });

  it("chain-error → cache hit: returns the cached snapshot when the chain read fails", async () => {
    const key = identityKey("funkhaus", "bar-east-01");
    const cached = {
      schemaVersion: 3,
      registryVersion: "5",
      table: {
        [key]: {
          merchantId: "funkhaus",
          terminalId: "bar-east-01",
          destination: { kind: "accountId32", value: "0x" + "33".repeat(32) },
          displayName: "Bar East (cached)",
          status: "active",
          addedAt: "2026-04-01T00:00:00Z",
        },
      },
    };
    const store = makeMemoryStore({
      [MERCHANT_CACHE_KEY]: JSON.stringify(cached),
    });
    const failingClient = makeFakeClient({
      version: 1n,
      rows: [],
      succeed: false,
    });
    const warnings: string[] = [];
    const result = await loadMerchants({
      registryAddress: REGISTRY_ADDRESS,
      client: failingClient,
      store,
      onWarn: (m) => warnings.push(m),
    });
    expect(result.source).toBe("cache");
    expect(result.registryVersion).toBe(5n);
    expect(result.table[key]!.displayName).toBe("Bar East (cached)");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("chain-error + no cache: resolves to an empty table", async () => {
    const failingClient = makeFakeClient({
      version: 1n,
      rows: [],
      succeed: false,
    });
    const result = await loadMerchants({
      registryAddress: REGISTRY_ADDRESS,
      client: failingClient,
      store: makeMemoryStore(),
    });
    expect(result.source).toBe("empty");
    expect(result.table).toEqual({});
  });

  it("version-equal short-circuit: returns cache without rereading rows", async () => {
    const key = identityKey("funkhaus", "bar-east-01");
    const cached = {
      schemaVersion: 3,
      registryVersion: "12",
      table: {
        [key]: {
          merchantId: "funkhaus",
          terminalId: "bar-east-01",
          destination: { kind: "accountId32", value: "0x" + "44".repeat(32) },
          displayName: "Stable",
          status: "active",
          addedAt: "2026-03-01T00:00:00Z",
        },
      },
    };
    const store = makeMemoryStore({
      [MERCHANT_CACHE_KEY]: JSON.stringify(cached),
    });
    const client = makeFakeClient({ version: 12n, rows: [] });
    const result = await loadMerchants({
      registryAddress: REGISTRY_ADDRESS,
      client,
      store,
    });
    expect(result.source).toBe("cache-version-match");
    expect(result.registryVersion).toBe(12n);
    expect(result.table[key]!.displayName).toBe("Stable");
    // One call: getVersion. No getAllTerminalKeys, no per-key reads.
    expect(client.call).toHaveBeenCalledTimes(1);
  });

  it("chain timeout falls back to cache, then empty", async () => {
    const store = makeMemoryStore();
    const slowClient = {
      getUnsafeApi: () => ({
        apis: {
          ReviveApi: {
            // Returns a never-resolving promise — exercises the loader's timeout.
            call: vi.fn(() => new Promise<never>(() => undefined)),
          },
        },
      }),
    } as unknown as PolkadotClient;
    const result = await loadMerchants({
      registryAddress: REGISTRY_ADDRESS,
      client: slowClient,
      store,
      timeoutMs: 20,
    });
    expect(result.source).toBe("empty");
  });

  it("empty registryAddress skips chain entirely and resolves to empty", async () => {
    const client = makeFakeClient({ version: 1n, rows: [] });
    const result = await loadMerchants({
      registryAddress: "",
      client,
    });
    expect(result.source).toBe("empty");
    expect(client.call).not.toHaveBeenCalled();
  });

  it("ignores a cached snapshot from a previous schema version", async () => {
    const store = makeMemoryStore({
      [MERCHANT_CACHE_KEY]: JSON.stringify({
        schemaVersion: 2, // old shape (pre-status field, pre-AccountId32 destination)
        registryVersion: "9",
        table: {},
      }),
    });
    const client = makeFakeClient({
      version: 9n, // version-equal would short-circuit if the snapshot were trusted
      rows: [
        {
          merchantId: "fresh",
          terminalId: "till-01",
          destinationAccountId: "0x" + "12".repeat(32),
          displayName: "Fresh chain row",
          status: 0,
          addedAt: 1_700_000_500n,
          updatedAt: 1_700_000_500n,
        },
      ],
    });
    const result = await loadMerchants({
      registryAddress: REGISTRY_ADDRESS,
      client,
      store,
    });
    // Old-schema snapshot is dropped; loader proceeds with a full chain read.
    expect(result.source).toBe("chain");
    expect(result.table[identityKey("fresh", "till-01")]!.displayName).toBe(
      "Fresh chain row",
    );
  });

  it("drops a malformed cached entry instead of poisoning the runtime", async () => {
    const store = makeMemoryStore({
      [MERCHANT_CACHE_KEY]: JSON.stringify({
        schemaVersion: 3,
        registryVersion: "1",
        table: {
          "bad|entry": {
            merchantId: "bad",
            terminalId: "entry",
            displayName: "missing destination",
            status: "active",
            addedAt: "2026-01-01T00:00:00Z",
            // no `destination` field — should fail sanitization
          },
        },
      }),
    });
    const failingClient = makeFakeClient({ version: 1n, rows: [], succeed: false });
    const result = await loadMerchants({
      registryAddress: REGISTRY_ADDRESS,
      client: failingClient,
      store,
    });
    expect(result.source).toBe("empty");
  });

  it("forwards a caller-supplied mapped dry-run origin to the revive call", async () => {
    // Generic callers may override the sentinel, but the supplied origin must
    // already be mapped in pallet-revive.
    const walletOrigin = "5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw";
    const client = makeFakeClient({
      version: 1n,
      rows: [
        {
          merchantId: "funkhaus",
          terminalId: "bar-east-01",
          destinationAccountId: "0x" + "11".repeat(32),
          displayName: "Bar East",
          status: 0,
          addedAt: 1_700_000_000n,
          updatedAt: 1_700_000_000n,
        },
      ],
    });
    await loadMerchants({
      registryAddress: REGISTRY_ADDRESS,
      client,
      origin: walletOrigin,
      store: makeMemoryStore(),
    });
    expect(client.call.mock.calls.length).toBeGreaterThan(0);
    for (const call of client.call.mock.calls) {
      expect(call[0]).toBe(walletOrigin);
    }
  });

  it("falls back to the mapped read-only sentinel when no origin is supplied", async () => {
    // Boot / standalone / pre-wallet-ready: origin omitted → loader uses
    // the config sentinel so cached and first-boot reads still work.
    const client = makeFakeClient({ version: 1n, rows: [] });
    await loadMerchants({
      registryAddress: REGISTRY_ADDRESS,
      client,
      store: makeMemoryStore(),
    });
    expect(client.call.mock.calls.length).toBeGreaterThan(0);
    for (const call of client.call.mock.calls) {
      expect(call[0]).toBe(READ_ONLY_ORIGIN);
    }
  });
});

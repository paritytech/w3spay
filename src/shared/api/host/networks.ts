/**
 * Network Registry
 *
 * Source of truth for per-network chain configuration. The active network is
 * picked at deploy time via VITE_NETWORK (browser) or NETWORK (Node scripts).
 * resolveNetwork() throws on unknown keys so misconfigured deployments fail
 * loudly at boot rather than silently running against the wrong chain.
 *
 * Adding a new network: append an entry to NETWORKS below and add the key to
 * SUPPORTED_NETWORKS. Genesis hashes can be fetched via:
 *   chain_getBlockHash with params [0] over JSON-RPC.
 */

export type NetworkKey = "paseo" | "paseo-next-v2" | "previewnet";

export const SUPPORTED_NETWORKS: NetworkKey[] = [
  "paseo",
  "paseo-next-v2",
  "previewnet",
];
export const DEFAULT_NETWORK: NetworkKey = "paseo";

export interface ChainEndpoint {
  /** WebSocket RPC URL for direct (standalone) connection. */
  wsUrl: string;
  /**
   * Genesis hash. Used as the cache key for PAPI clients in client.ts and as
   * the chain identifier passed to the host-sdk's createPapiProvider() in
   * host mode.
   *
   * Empty string means the genesis must be supplied at runtime via
   * VITE_CHAIN_GENESIS_HASH / VITE_BULLETIN_GENESIS_HASH (typically populated
   * by `bun run sync-network` for unstable networks like previewnet that get
   * rebuilt frequently).
   */
  genesisHash: `0x${string}` | "";
}

export interface NativeToken {
  symbol: string;
  decimals: number;
}

export interface NetworkConfig {
  key: NetworkKey;
  /** Human-readable label for diagnostics + UI surfaces. */
  displayName: string;
  isTestnet: boolean;
  /** Asset Hub-like main parachain — pallet-revive contracts live here. */
  mainChain: ChainEndpoint;
  /**
   * Bulletin chain for off-chain metadata storage via TransactionStorage.
   * null if a network has none — bulletin-dependent code must guard.
   */
  bulletinChain: ChainEndpoint | null;
  /**
   * People-system parachain (Paseo Individuality / "Paseo People Next" on
   * paseo-next-v2) where the CASH (pUSD) foreign asset lives — `pallet-assets`
   * keyed by the token's XCM Location. `null` when a network has no people
   * chain; people-chain-dependent code (the CASH balance lookup behind the
   * admin Balances tab) must guard and treat null as "feature unavailable".
   */
  peopleChain: ChainEndpoint | null;
  /** HTTP IPFS gateway used to resolve content addressed by Bulletin CIDs. */
  ipfsGateway: string;
  /** Native token of the main chain — drives balance display + fee math. */
  nativeToken: NativeToken;
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  paseo: {
    key: "paseo",
    displayName: "Paseo Asset Hub",
    isTestnet: true,
    mainChain: {
      wsUrl: "wss://asset-hub-paseo.ibp.network",
      genesisHash:
        "0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2",
    },
    bulletinChain: {
      wsUrl: "wss://paseo-bulletin-rpc.polkadot.io",
      genesisHash:
        "0x744960c32e3a3df5440e1ecd4d34096f1ce2230d7016a5ada8a765d5a622b4ea",
    },
    peopleChain: null,
    ipfsGateway: "https://paseo-ipfs.polkadot.io",
    nativeToken: { symbol: "PAS", decimals: 10 },
  },
  "paseo-next-v2": {
    key: "paseo-next-v2",
    displayName: "Paseo Next V2",
    isTestnet: true,
    // Endpoints + genesis hashes mirror polkadot-desktop's environment registry
    // like previewnet, so there's no need for the empty-hash + sync-network
    // dance.
    mainChain: {
      wsUrl: "wss://paseo-asset-hub-next-rpc.polkadot.io",
      genesisHash:
        "0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f",
    },
    bulletinChain: {
      wsUrl: "wss://paseo-bulletin-next-rpc.polkadot.io",
      genesisHash:
        "0x8cfe6717dc4becfda2e13c488a1e2061ff2dfee96e7d031157f72d36716c0a22",
    },
    // Paseo People Next (people-system parachain) — hosts the CASH (pUSD)
    // foreign asset queried by the admin Balances tab. Genesis verified live
    // against the running chain (chain_getBlockHash(0) + chainSpec genesisHash).
    peopleChain: {
      wsUrl: "wss://paseo-people-next-system-rpc.polkadot.io",
      genesisHash:
        "0xc5af1826b31493f08b7e2a823842f98575b806a784126f28da9608c68665afa5",
    },
    ipfsGateway: "https://paseo-bulletin-next-ipfs.polkadot.io",
    nativeToken: { symbol: "PAS", decimals: 10 },
  },
  previewnet: {
    key: "previewnet",
    displayName: "Previewnet (substrate.dev)",
    isTestnet: true,
    // Genesis hashes intentionally empty — previewnet is rebuilt frequently
    // from runtimes#master, so any compile-time hash would go stale. Run
    // `bun run sync-network` (or the CI step) to populate them via env vars.
    mainChain: {
      wsUrl: "wss://previewnet.substrate.dev/asset-hub",
      genesisHash:
        "0x29f7b15e6227f86b90bf5199b5c872c28649a30e5f15fae6dd8fa9d5d48d6fbb",
    },
    bulletinChain: {
      wsUrl: "wss://previewnet.substrate.dev/bulletin",
      genesisHash:
        "0xf37fa1f1450ea120edbf64c3fc447f671a00e1f1095a698f42eeec073c7ee487",
    },
    peopleChain: null,
    ipfsGateway: "https://previewnet.substrate.dev/ipfs/",
    nativeToken: { symbol: "PAS", decimals: 10 },
  },
};

export function parseNetworkKey(
  value: string | undefined | null,
): NetworkKey | null {
  if (!value) return null;
  return (SUPPORTED_NETWORKS as string[]).includes(value)
    ? (value as NetworkKey)
    : null;
}

export interface NetworkOverrides {
  /** Override the main chain's genesis hash (typically from VITE_CHAIN_GENESIS_HASH). */
  mainGenesisHash?: string;
  /** Override the bulletin chain's genesis hash (typically from VITE_BULLETIN_GENESIS_HASH). */
  bulletinGenesisHash?: string;
}

const GENESIS_HASH_RE = /^0x[0-9a-f]{64}$/i;

function assertGenesisHashShape(
  value: string,
  label: string,
): `0x${string}` | "" {
  if (value === "" || GENESIS_HASH_RE.test(value))
    return value as `0x${string}` | "";
  const preview = value.length > 20 ? `${value.slice(0, 20)}…` : value;
  throw new Error(
    `Invalid ${label}: expected 0x + 64 hex chars, got "${preview}"`,
  );
}

/**
 * Apply per-field env overrides on top of a registry entry. Empty/undefined
 * overrides fall back to the registry value, so a network entry can ship with
 * stable hashes (paseo) or empty placeholders (previewnet) and selectively
 * accept overrides. Throws on malformed hashes so a typo in env doesn't reach
 * PAPI as an opaque mid-boot error.
 */
function applyOverrides(
  network: NetworkConfig,
  overrides: NetworkOverrides,
): NetworkConfig {
  return {
    ...network,
    mainChain: {
      ...network.mainChain,
      genesisHash: assertGenesisHashShape(
        overrides.mainGenesisHash || network.mainChain.genesisHash,
        `${network.key} main chain genesis hash`,
      ),
    },
    bulletinChain: network.bulletinChain
      ? {
          ...network.bulletinChain,
          genesisHash: assertGenesisHashShape(
            overrides.bulletinGenesisHash || network.bulletinChain.genesisHash,
            `${network.key} bulletin chain genesis hash`,
          ),
        }
      : null,
  };
}

/**
 * Resolve a raw network key string to a NetworkConfig, applying any env-based
 * genesis-hash overrides on top.
 *
 * - Empty/undefined key → DEFAULT_NETWORK
 * - Unknown key → throws
 * - Genesis hashes left empty in the registry must be supplied via overrides;
 *   callers that need a fully-populated config should validate after this call
 *   (see constants.ts).
 */
export function resolveNetwork(
  key: string | undefined | null,
  overrides: NetworkOverrides = {},
): NetworkConfig {
  if (!key) return applyOverrides(NETWORKS[DEFAULT_NETWORK], overrides);
  const parsed = parseNetworkKey(key);
  if (!parsed) {
    throw new Error(
      `Unknown network "${key}". Valid values: ${SUPPORTED_NETWORKS.join(", ")}`,
    );
  }
  return applyOverrides(NETWORKS[parsed], overrides);
}
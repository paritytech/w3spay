import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const unsafeApi = { kind: "unsafe-api" };
  const rawClient = {
    getUnsafeApi: vi.fn(() => unsafeApi),
    destroy: vi.fn(),
  };
  return {
    TEST_GENESIS: "0xtest000000000000000000000000000000000000000000000000000000000000" as const,
    TEST_WS: "wss://test.example.com",
    unsafeApi,
    rawClient,
    getOrCreateClient: vi.fn(() => rawClient),
    resetClientCache: vi.fn(),
    isInHost: vi.fn<() => boolean>(() => false),
  };
});

vi.mock("@/sdk", () => ({
  getOrCreateClient: mocks.getOrCreateClient,
  isInHost: mocks.isInHost,
  resetClientCache: mocks.resetClientCache,
  resolveNetwork: () => ({
    key: "paseo-next-v2",
    displayName: "Test",
    isTestnet: true,
    mainChain: { genesisHash: mocks.TEST_GENESIS, wsUrl: mocks.TEST_WS },
    bulletinChain: null,
    peopleChain: null,
    ipfsGateway: "",
    nativeToken: { symbol: "PAS", decimals: 10 },
  }),
}));

vi.mock("@/shared/config.ts", () => ({
  envConfig: {
    chain: { network: "paseo-next-v2" },
  },
}));

import {
  resetMainClient,
  useAssetHubClient,
  usePeopleClient,
} from "@/features/host/lib/client.ts";

afterEach(() => {
  resetMainClient();
  vi.clearAllMocks();
  mocks.isInHost.mockReturnValue(false);
});

describe("w3spay chain client transport", () => {
  it("uses auto transport in host mode for merchant registry reads", () => {
    mocks.isInHost.mockReturnValue(true);

    const main = useAssetHubClient();

    expect(mocks.getOrCreateClient).toHaveBeenCalledWith(
      mocks.TEST_GENESIS,
      mocks.TEST_WS,
      mocks.isInHost,
      "auto",
    );
    expect(main.client).toBe(mocks.rawClient);
    expect(main.unsafeApi).toBe(mocks.unsafeApi);
  });

  it("uses auto transport in standalone mode too", () => {
    mocks.isInHost.mockReturnValue(false);

    const main = useAssetHubClient();

    expect(mocks.getOrCreateClient).toHaveBeenCalledWith(
      mocks.TEST_GENESIS,
      mocks.TEST_WS,
      mocks.isInHost,
      "auto",
    );
    expect(main.client).toBe(mocks.rawClient);
  });

  it("keeps the balance helper on the same forced-WS main-chain client", () => {
    const people = usePeopleClient();

    expect(mocks.getOrCreateClient).toHaveBeenCalledWith(
      mocks.TEST_GENESIS,
      mocks.TEST_WS,
      mocks.isInHost,
      "ws",
    );
    expect(people?.client).toBe(mocks.rawClient);
  });

  it("delegates reset to the shared client cache", () => {
    resetMainClient();

    expect(mocks.resetClientCache).toHaveBeenCalledTimes(1);
  });
});

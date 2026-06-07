import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Provider-selection unit test for the shared PAPI client cache.
 *
 * The app-level wrappers (`client.test.ts`) mock `getOrCreateClient`
 * wholesale, so the transport branching itself is covered here. The
 * behaviour under test is the wired WS fallback: in host + `"auto"`,
 * `createPapiProvider` now receives the WS provider as its 2nd argument, so a
 * chain the host does not advertise degrades to direct WS instead of the dead
 * provider it returned before. The `!inHost()` and forced-`"ws"` branches
 * still bypass `createPapiProvider` entirely — it throws outside a host and
 * its fallback never fires for chains the host advertises-but-breaks.
 */
const mocks = vi.hoisted(() => {
  const wsProvider = { kind: "ws-provider" } as unknown;
  const hostProvider = { kind: "host-provider" } as unknown;
  return {
    wsProvider,
    hostProvider,
    getWsProvider: vi.fn(() => wsProvider),
    createPapiProvider: vi.fn(() => hostProvider),
    createClient: vi.fn((provider: unknown) => ({ provider, destroy: vi.fn() })),
  };
});

vi.mock("@novasamatech/host-api-wrapper", () => ({
  createPapiProvider: mocks.createPapiProvider,
}));
vi.mock("@polkadot-api/ws-provider", () => ({
  getWsProvider: mocks.getWsProvider,
}));
vi.mock("polkadot-api", () => ({
  createClient: mocks.createClient,
}));

import { getOrCreateClient, resetClientCache } from "@/shared/api/host/client.ts";

const GENESIS =
  "0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f" as const;
const WS = "wss://example.test";

afterEach(() => {
  resetClientCache();
  vi.clearAllMocks();
});

describe("getOrCreateClient transport selection", () => {
  it("auto + in host: routes through createPapiProvider with the WS provider as fallback", () => {
    getOrCreateClient(GENESIS, WS);

    expect(mocks.getWsProvider).toHaveBeenCalledWith(WS);
    expect(mocks.createPapiProvider).toHaveBeenCalledWith(GENESIS, mocks.wsProvider);
    expect(mocks.createClient).toHaveBeenCalledWith(mocks.hostProvider);
  });

  it("standalone (!inHost): uses the WS provider directly, never createPapiProvider", () => {
    getOrCreateClient(GENESIS, WS);

    expect(mocks.createPapiProvider).not.toHaveBeenCalled();
    expect(mocks.createClient).toHaveBeenCalledWith(mocks.wsProvider);
  });

  it('forced "ws": uses the WS provider directly even in host', () => {
    getOrCreateClient(GENESIS, WS);

    expect(mocks.createPapiProvider).not.toHaveBeenCalled();
    expect(mocks.createClient).toHaveBeenCalledWith(mocks.wsProvider);
  });

  it("caches one client per genesis hash", () => {
    const a = getOrCreateClient(GENESIS, WS);
    const b = getOrCreateClient(GENESIS, WS);

    expect(a).toBe(b);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";

import { envConfig } from "@/config";

/**
 * These assertions lock the project-wide constants that other modules
 * depend on for *behavioral* defaults (storage envelope, host wait
 * policy, display ticker). Accidentally tweaking any of them in a casual
 * edit should fail this suite before the regression escapes to a
 * deployed bundle.
 */
describe("envConfig", () => {
  it("locks token identity", () => {
    expect(envConfig.token.symbol).toBe("CASH TOKEN");
    // Derived from CASH TOKEN wire decimals (6) and cent display precision (2).
    expect(envConfig.token.plancksPerCent).toBe(10_000);
  });

  it("locks the dev seed balance", () => {
    // 10_000_000_000 plancks ≈ 10_000 CASH TOKEN (10⁶ plancks per token).
    expect(envConfig.payment.devStartingBalancePlancks).toBe(10_000_000_000);
  });

  it("locks host wait policy", () => {
    expect(envConfig.host.pollIntervalMs).toBe(50);
    expect(envConfig.host.waitTimeoutMs).toBe(3_000);
    expect(envConfig.host.standaloneWaitTimeoutMs).toBe(250);
    // sanity: the standalone (no-bridge) wait MUST stay shorter than the
    // hosted wait, otherwise dev-mode boots take a full host timeout.
    expect(envConfig.host.standaloneWaitTimeoutMs).toBeLessThan(envConfig.host.waitTimeoutMs);
  });

  it("locks the read-origin AccountId used for revive eth_call", () => {
    // Same constant as `apps/t3rminal-v1/lib/contracts/revive-bulletin-index.ts`.
    // Changing this breaks every read from the merchant registry.
    expect(envConfig.chain.readOnlyOrigin).toBe(
      "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    );
  });

  it("locks merchant pilot-id shape and default", () => {
    // `merchant.pilotId` keys every TSE-scan lookup against the on-chain
    // registry as `(pilotId, kassenSerial)`. Lock the SHAPE (non-empty
    // string) so the field can't accidentally vanish, and lock the
    // default to `"funkhaus"` so dev/test builds resolve the pilot
    // operator without env plumbing.
    expect(typeof envConfig.merchant.pilotId).toBe("string");
    expect(envConfig.merchant.pilotId.length).toBeGreaterThan(0);
    expect(envConfig.merchant.pilotId).toBe("funkhaus");
  });

  it("requires VITE_DOTNS_PRODUCT_DOMAIN and propagates its value", async () => {
    // `host.productDotNs` is the SPA's own DOTNS identifier; the host wallet
    // adapter uses it to derive the product account, and `deploy.sh` reads
    // the same env var as the bulletin-deploy target. The contract is:
    // missing → throw at module load; present → propagate verbatim. We
    // stub the env to avoid dependence on the developer's ambient shell.
    const KEY = "VITE_DOTNS_PRODUCT_DOMAIN";
    const saved = process.env[KEY];
    try {
      // Missing env var must throw — no silent default to `w3spay.dot`.
      delete process.env[KEY];
      vi.resetModules();
      await expect(import("@/config")).rejects.toThrow(
        /VITE_DOTNS_PRODUCT_DOMAIN is required/,
      );
      // Empty string is treated the same as missing.
      process.env[KEY] = "";
      vi.resetModules();
      await expect(import("@/config")).rejects.toThrow(
        /VITE_DOTNS_PRODUCT_DOMAIN is required/,
      );
      // Present value propagates verbatim.
      process.env[KEY] = "staging-w3spay.dot";
      vi.resetModules();
      const overridden = (await import("@/config")).envConfig;
      expect(overridden.host.productDotNs).toBe("staging-w3spay.dot");
    } finally {
      if (saved === undefined) delete process.env[KEY];
      else process.env[KEY] = saved;
      vi.resetModules();
    }
  });

  it("locks feature-flag shape", () => {
    // `features` is a deliberately consumer-tuneable surface — lock the
    // SHAPE (each flag is a boolean) but never the value, so flipping a
    // flag in config.ts doesn't trip its own test.
    expect(typeof envConfig.features.tipScreen).toBe("boolean");
    expect(typeof envConfig.features.devPaymentOverride).toBe("boolean");
  });
});

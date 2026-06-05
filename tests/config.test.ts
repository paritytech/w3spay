import { describe, expect, it } from "vitest";

import { envConfig } from "@/shared/config.ts";

/**
 * These assertions lock the project-wide constants that other modules
 * depend on for *behavioral* defaults (storage envelope, host wait
 * policy, display ticker). Accidentally tweaking any of them in a casual
 * edit should fail this suite before the regression escapes to a
 * deployed bundle.
 */
describe("envConfig", () => {
  it("locks token identity", () => {
    expect(envConfig.token.name).toBe("CASH");
    expect(envConfig.token.symbol).toBe("CASH");
    expect(envConfig.token.decimals).toBe(6);
    expect(envConfig.token.displayDecimals).toBe(2);
    // Derived: 10^(decimals - displayDecimals) = 10_000 for CASH.
    expect(envConfig.token.plancksPerCent).toBe(10_000);
  });

  it("locks payment-history envelope", () => {
    expect(envConfig.storage.paymentHistoryKey).toBe("w3spay:payment-history:v2");
    expect(envConfig.storage.paymentHistorySchemaVersion).toBe(4);
    expect(envConfig.storage.paymentHistoryMaxEntries).toBe(100);
  });

  it("locks payment-threshold defaults", () => {
    expect(envConfig.payment.minSpendableCents).toBe(100);
    // 10_000_000_000 plancks ≈ 10_000 CASH (10⁶ plancks per token).
    expect(envConfig.payment.devStartingBalancePlancks).toBe(10_000_000_000);
    // Dummy fallback must clear the spend threshold by a comfortable margin
    // so the demo flow actually advances past the confirm screen.
    expect(envConfig.payment.dummyBalanceCents).toBeGreaterThan(
      envConfig.payment.minSpendableCents,
    );
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

  it("locks feature-flag shape", () => {
    // `features` is a deliberately consumer-tuneable surface — lock the
    // SHAPE (each flag is a boolean) but never the value, so flipping a
    // flag in config.ts doesn't trip its own test.
    expect(typeof envConfig.features.tipScreen).toBe("boolean");
    expect(typeof envConfig.features.devPaymentOverride).toBe("boolean");
  });
});

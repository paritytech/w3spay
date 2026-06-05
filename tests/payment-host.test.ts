import { describe, expect, it } from "vitest";
import type { PaymentStatus } from "@/shared/api/host";

import { envConfig } from "@/shared/config.ts";
const TOKEN_PLANCKS_PER_CENT = envConfig.token.plancksPerCent;
import {
  createStandardPaymentHost,
  resolvePaymentHost,
  type PaymentHost,
  type StandardPaymentManager,
} from "@/features/host/lib/payment-host.ts";

function hostWithId(id: string): PaymentHost {
  return {
    async paymentBalance() {
      return { available: id.length };
    },
    async paymentRequest() {
      return { id };
    },
  };
}

function subscription() {
  return {
    unsubscribe() {},
    onInterrupt() {
      return () => {};
    },
  };
}

function managerWithBalance(available: bigint): StandardPaymentManager {
  return {
    subscribeBalance(callback) {
      queueMicrotask(() => callback({ available }));
      return subscription();
    },
    async requestPayment(amount, destination) {
      return { id: `${amount}:${destination.length}` };
    },
    subscribePaymentStatus(_id, callback) {
      queueMicrotask(() => callback({ type: "completed" }));
      return subscription();
    },
  };
}

interface ControllableStatusManager {
  manager: StandardPaymentManager;
  emit(status: PaymentStatus): void;
  interrupt(payload: unknown): void;
  readonly unsubscribeCount: number;
}

function controllableStatusManager(receiptId = "settled-payment"): ControllableStatusManager {
  let unsubscribeCount = 0;
  let statusCallback: ((status: PaymentStatus) => void) | null = null;
  const interruptHandlers: Array<(payload: unknown) => void> = [];

  const manager: StandardPaymentManager = {
    subscribeBalance(callback) {
      queueMicrotask(() => callback({ available: 0n }));
      return subscription();
    },
    async requestPayment() {
      return { id: receiptId };
    },
    subscribePaymentStatus(_id, callback) {
      statusCallback = callback;
      return {
        unsubscribe() {
          unsubscribeCount += 1;
        },
        onInterrupt(handler) {
          interruptHandlers.push(handler);
          return () => {};
        },
      };
    },
  };

  return {
    manager,
    emit(status) {
      statusCallback?.(status);
    },
    interrupt(payload) {
      for (const handler of interruptHandlers) handler(payload);
    },
    get unsubscribeCount() {
      return unsubscribeCount;
    },
  };
}

describe("resolvePaymentHost", () => {
  it("uses the dev reference host in dev standalone", () => {
    const dev = hostWithId("dev");
    const standard = hostWithId("standard");

    const selected = resolvePaymentHost({
      devStandalone: true,
      hosted: true,
      hostApiReady: true,
      getDevHost: () => dev,
      createStandardHost: () => standard,
    });

    expect(selected).toBe(dev);
  });

  it("selects the standard Host API adapter when hosted and the host API is ready", () => {
    const standard = hostWithId("standard");

    const selected = resolvePaymentHost({
      devStandalone: false,
      hosted: true,
      hostApiReady: true,
      getDevHost: () => hostWithId("dev"),
      createStandardHost: () => standard,
    });

    expect(selected).toBe(standard);
  });

  it("returns null when hosted but the host API is not ready yet", () => {
    const selected = resolvePaymentHost({
      devStandalone: false,
      hosted: true,
      hostApiReady: false,
      getDevHost: () => hostWithId("dev"),
      createStandardHost: () => {
        throw new Error("standard host factory should not run before the host API is ready");
      },
    });

    expect(selected).toBeNull();
  });

  it("returns null in production standalone (no host)", () => {
    const selected = resolvePaymentHost({
      devStandalone: false,
      hosted: false,
      hostApiReady: false,
      getDevHost: () => hostWithId("dev"),
      createStandardHost: () => hostWithId("standard"),
    });

    expect(selected).toBeNull();
  });
});

describe("createStandardPaymentHost", () => {
  it("divides the bigint planck balance down to a cent-denominated number", async () => {
    // 1_230_000n plancks = 123_0000 / 10_000 = 123 cents.
    const host = createStandardPaymentHost(managerWithBalance(1_230_000n));

    await expect(host.paymentBalance()).resolves.toEqual({ available: 123 });
  });

  it("fails explicitly when the host balance (in cents) exceeds Number.MAX_SAFE_INTEGER", async () => {
    const overflowingPlancks =
      (BigInt(Number.MAX_SAFE_INTEGER) + 1n) * BigInt(TOKEN_PLANCKS_PER_CENT);
    const host = createStandardPaymentHost(managerWithBalance(overflowingPlancks));

    await expect(host.paymentBalance()).rejects.toThrow(/Number\.MAX_SAFE_INTEGER/);
  });

  it("multiplies the cent amount up to plancks (bigint) and forwards destination bytes unchanged", async () => {
    const destination = new Uint8Array([0xaa, 0xbb, 0xcc]);
    let observedAmount: bigint | null = null;
    let observedDestination: Uint8Array | null = null;
    const manager: StandardPaymentManager = {
      subscribeBalance(callback) {
        queueMicrotask(() => callback({ available: 0n }));
        return subscription();
      },
      async requestPayment(amount, paymentDestination) {
        observedAmount = amount;
        observedDestination = paymentDestination;
        return { id: "standard-payment" };
      },
      subscribePaymentStatus(_id, callback) {
        queueMicrotask(() => callback({ type: "completed" }));
        return subscription();
      },
    };

    const receipt = await createStandardPaymentHost(manager).paymentRequest(42, destination);

    expect(receipt).toEqual({ id: "standard-payment", settlement: "settled" });
    expect(observedAmount).toBe(42n * BigInt(TOKEN_PLANCKS_PER_CENT));
    expect(observedDestination).toBe(destination);
  });
});
describe("createStandardPaymentHost paymentRequest waits for terminal status", () => {
  it("resolves with the requestPayment receipt only after status reaches completed", async () => {
    const ctl = controllableStatusManager("settled-receipt");
    const host = createStandardPaymentHost(ctl.manager);

    const pending = host.paymentRequest(1, new Uint8Array(1));

    // Let requestPayment's resolved microtask flush so the status subscription
    // is wired up before we drive emissions.
    await Promise.resolve();
    ctl.emit({ type: "processing" });
    ctl.emit({ type: "completed" });

    await expect(pending).resolves.toEqual({ id: "settled-receipt", settlement: "settled" });
  });

  it("rejects with the host-side reason when status reaches failed", async () => {
    const ctl = controllableStatusManager();
    const host = createStandardPaymentHost(ctl.manager);

    const pending = host.paymentRequest(1, new Uint8Array(1));
    await Promise.resolve();
    ctl.emit({ type: "failed", reason: "insufficient balance" });

    await expect(pending).rejects.toThrow(/insufficient balance/);
  });

  it("resolves as unconfirmed when the status subscription is interrupted before a terminal status", async () => {
    const ctl = controllableStatusManager("interrupted-receipt");
    const host = createStandardPaymentHost(ctl.manager);

    const pending = host.paymentRequest(1, new Uint8Array(1));
    await Promise.resolve();
    ctl.interrupt({ message: "channel disconnected" });

    // Interrupt is a "we don't know" — the host may still have settled
    // the extrinsic in a background worker. Surface as unconfirmed so
    // the UI can reconcile instead of mis-reporting as failed.
    await expect(pending).resolves.toEqual({
      id: "interrupted-receipt",
      settlement: "unconfirmed",
    });
  });

  it("stays pending while only processing status has been emitted", async () => {
    const ctl = controllableStatusManager();
    const host = createStandardPaymentHost(ctl.manager);

    const pending = host.paymentRequest(1, new Uint8Array(1));
    await Promise.resolve();
    ctl.emit({ type: "processing" });

    const winner = await Promise.race([
      pending.then(() => "settled" as const),
      Promise.resolve("idle" as const),
    ]);
    expect(winner).toBe("idle");

    ctl.emit({ type: "completed" });
    await expect(pending).resolves.toBeDefined();
  });

  it("unsubscribes exactly once on terminal completed status, ignoring late callbacks", async () => {
    const ctl = controllableStatusManager();
    const host = createStandardPaymentHost(ctl.manager);

    const pending = host.paymentRequest(1, new Uint8Array(1));
    await Promise.resolve();
    ctl.emit({ type: "completed" });
    await pending;

    expect(ctl.unsubscribeCount).toBe(1);

    // A late emission after the latch has settled must not double-unsubscribe.
    ctl.emit({ type: "failed", reason: "stale" });
    expect(ctl.unsubscribeCount).toBe(1);
  });

  it("unsubscribes exactly once on terminal failed status", async () => {
    const ctl = controllableStatusManager();
    const host = createStandardPaymentHost(ctl.manager);

    const pending = host.paymentRequest(1, new Uint8Array(1));
    await Promise.resolve();
    ctl.emit({ type: "failed", reason: "boom" });
    await expect(pending).rejects.toThrow(/boom/);

    expect(ctl.unsubscribeCount).toBe(1);
  });
});

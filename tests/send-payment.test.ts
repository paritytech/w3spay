import { describe, expect, it } from "vitest";
import type { PaymentStatus } from "@/shared/api/host";

import { envConfig } from "@/config";
import { sendPayment } from "@/features/payment/api/send-payment.ts";
import type { PaymentManager } from "@/features/payment/lib/payment-sender.ts";

const TOKEN_PLANCKS_PER_CENT = envConfig.token.plancksPerCent;

function subscription() {
  return {
    unsubscribe() {},
    onInterrupt() {
      return () => {};
    },
  };
}

interface ControllableStatusManager {
  manager: PaymentManager;
  emit(status: PaymentStatus): void;
  interrupt(payload: unknown): void;
  readonly unsubscribeCount: number;
}

function controllableStatusManager(receiptId = "settled-payment"): ControllableStatusManager {
  let unsubscribeCount = 0;
  let statusCallback: ((status: PaymentStatus) => void) | null = null;
  const interruptHandlers: Array<(payload: unknown) => void> = [];

  const manager: PaymentManager = {
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

describe("sendPayment cents→plancks conversion", () => {
  it("multiplies the cent amount up to plancks (bigint) and forwards destination bytes unchanged", async () => {
    let observedAmount: bigint | null = null;
    let observedDestination: Uint8Array | null = null;
    const manager: PaymentManager = {
      async requestPayment(amount, destination) {
        observedAmount = amount;
        observedDestination = destination;
        return { id: "standard-payment" };
      },
      subscribePaymentStatus(_id, callback) {
        queueMicrotask(() => callback({ type: "completed" }));
        return subscription();
      },
    };

    const result = await sendPayment({
      manager,
      amountCents: 42,
      merchantDestination: {
        kind: "accountId32",
        // 32-byte hex (no destination conversion needed; just forwarded).
        value:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
      },
    });

    expect(result).toEqual({
      paymentId: "standard-payment",
      paidCents: 42,
      settlement: "settled",
    });
    expect(observedAmount).toBe(42n * BigInt(TOKEN_PLANCKS_PER_CENT));
    expect(observedDestination).not.toBeNull();
    expect((observedDestination as Uint8Array | null)?.length).toBe(32);
  });
});

describe("sendPayment settlement-wait", () => {
  it("resolves with the receipt only after status reaches completed", async () => {
    const ctl = controllableStatusManager("settled-receipt");
    const pending = sendPayment({
      manager: ctl.manager,
      amountCents: 1,
      merchantDestination: {
        kind: "accountId32",
        value:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
      },
    });

    // Yield so the status subscription is wired before we emit.
    await Promise.resolve();
    ctl.emit({ type: "processing" });
    await Promise.resolve();
    ctl.emit({ type: "completed" });

    await expect(pending).resolves.toEqual({
      paymentId: "settled-receipt",
      paidCents: 1,
      settlement: "settled",
    });
    expect(ctl.unsubscribeCount).toBe(1);
  });

  it("rejects with the failed reason when the status reaches failed", async () => {
    const ctl = controllableStatusManager();
    const pending = sendPayment({
      manager: ctl.manager,
      amountCents: 1,
      merchantDestination: {
        kind: "accountId32",
        value:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
      },
    });

    await Promise.resolve();
    ctl.emit({ type: "failed", reason: "insufficient funds" });

    await expect(pending).rejects.toThrow(/Payment failed: insufficient funds/);
    expect(ctl.unsubscribeCount).toBe(1);
  });

  it("resolves as unconfirmed when the status subscription is interrupted before a terminal status", async () => {
    const ctl = controllableStatusManager("interrupted-payment");
    const pending = sendPayment({
      manager: ctl.manager,
      amountCents: 1,
      merchantDestination: {
        kind: "accountId32",
        value:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
      },
    });

    await Promise.resolve();
    ctl.interrupt({ message: "channel disconnected" });

    await expect(pending).resolves.toEqual({
      paymentId: "interrupted-payment",
      paidCents: 1,
      settlement: "unconfirmed",
    });
    expect(ctl.unsubscribeCount).toBe(1);
  });
});

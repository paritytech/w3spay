import { describe, expect, it } from "vitest";

import { sendPayment } from "@/features/payment/api/send-payment.ts";
import type { PaymentManager } from "@/features/payment/lib/payment-sender.ts";

describe("sendPayment", () => {
  it("sends H160 merchant destinations as zero-left-padded AccountId32 bytes", async () => {
    const observed: { destination?: Uint8Array } = {};
    const manager: PaymentManager = {
      async requestPayment(_plancks, destination) {
        observed.destination = destination;
        return { id: "payment-1" };
      },
      subscribePaymentStatus(_id, callback) {
        queueMicrotask(() => callback({ type: "completed" }));
        return {
          unsubscribe() {},
          onInterrupt() {
            return () => {};
          },
        };
      },
    };

    const result = await sendPayment({
      manager,
      amountCents: 900,
      merchantDestination: {
        kind: "reviveContract",
        value: "0x1234567890abcdef1234567890abcdef12345678",
      },
    });

    expect(result).toEqual({ paymentId: "payment-1", paidCents: 900, settlement: "settled" });
    const destination = observed.destination;
    expect(destination).toBeInstanceOf(Uint8Array);
    if (destination === undefined) throw new Error("manager did not receive destination bytes");
    expect(destination).toHaveLength(32);
    expect([...destination.slice(0, 12)]).toEqual(new Array(12).fill(0));
    expect([...destination.slice(12)]).toEqual([
      0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0xcd, 0xef, 0x12, 0x34,
      0x56, 0x78, 0x90, 0xab, 0xcd, 0xef, 0x12, 0x34, 0x56, 0x78,
    ]);
  });
});

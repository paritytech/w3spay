/**
 * Serialization invariant for `runExclusiveHostModal`.
 *
 * The Polkadot host renders ONE permission / consent modal at a time and
 * silently drops any modal request that arrives while another is open.
 * This is the W3SPay boot-permission bug: the Sentry remote-origin grant
 * (fired pre-React from `instrument.ts`), the vault balance-access
 * consent, and the camera grant all raced — only the first modal
 * survived, and the rest didn't fire until the user left and re-entered
 * the app. The queue must:
 *   1. never let modal N+1 start before modal N settles, and
 *   2. keep draining after a denied / failed modal — a rejection must not
 *      wedge the chain (or a single "deny" would block every later
 *      permission).
 */
import { describe, expect, it } from "vitest";

import { runExclusiveHostModal } from "@/shared/api/host/connection.ts";

/** Resolve after the current macrotask so all pending microtasks drain. */
function flushMacrotask(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

describe("runExclusiveHostModal", () => {
  it("never starts the next modal before the current one settles", async () => {
    const events: string[] = [];
    const gate = Promise.withResolvers<void>();

    const first = runExclusiveHostModal(async () => {
      events.push("first:start");
      await gate.promise; // hold the lock open
      events.push("first:end");
      return 1;
    });
    const second = runExclusiveHostModal(async () => {
      events.push("second:start");
      return 2;
    });

    // First acquired the lock and parked; second must be queued behind it.
    await flushMacrotask();
    expect(events).toEqual(["first:start"]);

    gate.resolve();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("advances the queue after a modal call rejects", async () => {
    const order: string[] = [];

    const denied = runExclusiveHostModal(async () => {
      order.push("denied");
      throw new Error("user denied");
    });
    const next = runExclusiveHostModal(async () => {
      order.push("next");
      return "ok";
    });

    await expect(denied).rejects.toThrow("user denied");
    await expect(next).resolves.toBe("ok");
    expect(order).toEqual(["denied", "next"]);
  });

  it("returns each caller its own task result, in submission order", async () => {
    const results = await Promise.all([
      runExclusiveHostModal(async () => "a"),
      runExclusiveHostModal(async () => "b"),
      runExclusiveHostModal(async () => "c"),
    ]);
    expect(results).toEqual(["a", "b", "c"]);
  });
});

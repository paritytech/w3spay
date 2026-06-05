/**
 * Locks the reload-safety guard for the routed flow.
 *
 * Each data-carrying route's `beforeLoad` is `requireFlow(kind)`: it must
 * pass only when the session store holds the matching flow payload, and
 * redirect to the scan index otherwise. This is the property that makes a
 * cold reload / deep-link of, say, `/confirm` self-heal back to `/`
 * instead of rendering a screen with no payload — the "more idempotent"
 * goal of the router refactor.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { requireFlow } from "@/app/router/guards.ts";
import { useSessionStore } from "@/features/payment/store/session-store.ts";
import type { FlowStage } from "@/features/payment/lib/route-from-stage.ts";

const CONFIRM = {
  kind: "confirm",
  parsed: {
    amountCents: 100,
    kassenSerial: "serial",
    transactionNumber: 1,
    signatureCounter: 1,
  },
  merchant: {
    displayName: "Funkhaus",
    merchantId: "funkhaus",
    terminalId: "serial",
    destination: { kind: "accountId32", value: "0x00" },
  },
  tipCents: 0,
} as unknown as FlowStage;

function redirectTarget(run: () => void): string | undefined {
  try {
    run();
  } catch (thrown) {
    return (thrown as { options?: { to?: string } }).options?.to;
  }
  return undefined;
}

beforeEach(() => {
  useSessionStore.setState({ flow: null, lastBadScan: null, resolving: false });
});

describe("requireFlow", () => {
  it("passes when the active flow matches the route", () => {
    useSessionStore.setState({ flow: CONFIRM });
    expect(() => requireFlow("confirm")()).not.toThrow();
  });

  it("redirects to the index on a cold reload (no active flow)", () => {
    expect(redirectTarget(() => requireFlow("confirm")())).toBe("/");
  });

  it("redirects when the active flow is a different stage", () => {
    useSessionStore.setState({ flow: CONFIRM });
    expect(redirectTarget(() => requireFlow("tip")())).toBe("/");
  });
});

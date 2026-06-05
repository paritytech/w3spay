/**
 * Tests for `preferredDryRunOrigin` — the rule `useMerchantTable` uses to
 * choose the registry dry-run origin.
 *
 * Contract: prefer the ready host product-account SS58 address; fall back
 * to the mapped read-only sentinel before the wallet resolves (boot /
 * standalone / dev). The hook itself can't be rendered in the node test
 * env, so the preference is extracted here as a pure function.
 */

import { describe, expect, it } from "vitest";

import { preferredDryRunOrigin } from "@/features/merchants/api/queries.ts";

const SENTINEL = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const WALLET = "5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw";

describe("preferredDryRunOrigin", () => {
  it("prefers the host product-account address when the wallet is ready", () => {
    expect(
      preferredDryRunOrigin({ isReady: true, address: WALLET }, SENTINEL),
    ).toBe(WALLET);
  });

  it("falls back to the sentinel when the wallet is not ready", () => {
    expect(
      preferredDryRunOrigin({ isReady: false, address: WALLET }, SENTINEL),
    ).toBe(SENTINEL);
  });

  it("falls back to the sentinel when ready but no address resolved", () => {
    // Defensive: a `ready` state should always carry an address, but never
    // pass `null` straight through as an origin if it somehow doesn't.
    expect(
      preferredDryRunOrigin({ isReady: true, address: null }, SENTINEL),
    ).toBe(SENTINEL);
  });
});

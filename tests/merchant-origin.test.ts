/**
 * Tests for `merchantDryRunOrigin` — the rule all merchant-table reads use
 * to choose the registry dry-run origin.
 *
 * Contract: use the configured mapped read-only sentinel even after the host
 * wallet resolves. Product-account origins may be unmapped in pallet-revive,
 * which rejects even read-only `ReviveApi.call` dry-runs with
 * `Revive.AccountUnmapped`.
 */

import { describe, expect, it } from "vitest";

import { merchantDryRunOrigin } from "@/features/merchants/api/queries.ts";

const SENTINEL = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

describe("merchantDryRunOrigin", () => {
  it("uses the mapped read-only sentinel", () => {
    expect(merchantDryRunOrigin(SENTINEL)).toBe(SENTINEL);
  });
});

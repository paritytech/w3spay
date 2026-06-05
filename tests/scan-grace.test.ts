/**
 * Tests for the pure mapping used by the 60s scan-grace timer in
 * `app/stage-context.tsx`. Locks the post-grace UX to the same three
 * branches the original immediate-bail behaviour produced — only the
 * *timing* of the transition changed.
 */

import { describe, expect, it } from "vitest";

import {
  stageOnGraceExpiry,
  UNSUPPORTED_SCAN_GRACE_MS,
} from "@/features/payment/lib/stage.ts";

describe("stageOnGraceExpiry", () => {
  it("falls back to 'empty' when the camera decoded nothing at all", () => {
    expect(stageOnGraceExpiry(null)).toEqual({
      kind: "unsupportedScan",
      reason: "empty",
      raw: "",
    });
  });

  it("surfaces a captured unsupported reason verbatim", () => {
    expect(
      stageOnGraceExpiry({
        kind: "unsupported",
        reason: "polkadotUriScheme",
        raw: "polkadot:5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
      }),
    ).toEqual({
      kind: "unsupportedScan",
      reason: "polkadotUriScheme",
      raw: "polkadot:5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    });
  });

  it("wraps an invalid-TSE message into a scanError stage", () => {
    expect(
      stageOnGraceExpiry({ kind: "invalid", message: "wrong field count" }),
    ).toEqual({
      kind: "scanError",
      message: "Could not parse receipt QR: wrong field count",
    });
  });

  it("keeps the grace window at 60 seconds", () => {
    // Locked so changes go through review — UI copy and tests assume 60s.
    expect(UNSUPPORTED_SCAN_GRACE_MS).toBe(60_000);
  });
});

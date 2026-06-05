/**
 * Locks the stage→route mapping that bridges the pure stage-decision
 * functions (`app-stage.ts`) to the TanStack Router table. The decision
 * functions still own *which* stage; this table owns *which path* — a
 * drift here would silently strand a flow stage at the wrong URL.
 */

import { describe, expect, it } from "vitest";

import {
  FLOW_PATH,
  isFlowStage,
  stagePath,
  type FlowStage,
} from "@/features/payment/lib/route-from-stage.ts";
import type { AppStage } from "@/features/payment/lib/stage.ts";

const PARSED = {
  amountCents: 100,
  kassenSerial: "serial",
  transactionNumber: 1,
  signatureCounter: 1,
} as unknown as Extract<AppStage, { kind: "tip" }>["parsed"];

const MERCHANT = {
  displayName: "Funkhaus",
  merchantId: "funkhaus",
  terminalId: "serial",
  destination: { kind: "accountId32", value: "0x00" },
} as unknown as Extract<AppStage, { kind: "tip" }>["merchant"];

describe("FLOW_PATH", () => {
  it("maps every flow path to a distinct, leading-slash route", () => {
    const paths = Object.values(FLOW_PATH);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path.startsWith("/")).toBe(true);
  });
});

describe("isFlowStage / stagePath", () => {
  it("treats data-carrying stages as flow stages with a path", () => {
    const tip: AppStage = { kind: "tip", parsed: PARSED, merchant: MERCHANT };
    expect(isFlowStage(tip)).toBe(true);
    expect(stagePath(tip)).toBe("/tip");
  });

  it("routes a pay error to its own screen", () => {
    const stage: AppStage = {
      kind: "payError",
      message: "nope",
      parsed: PARSED,
      merchant: MERCHANT,
      tipCents: 0,
    };
    expect(stagePath(stage)).toBe("/pay-error");
  });

  it.each([
    "boot",
    "needsCamera",
    "needsLogin",
    "hostUnavailable",
    "scanning",
  ] as const)("treats the gate stage %s as non-flow (no path)", (kind) => {
    const stage = { kind, message: "" } as unknown as AppStage;
    expect(isFlowStage(stage)).toBe(false);
    expect(stagePath(stage)).toBeNull();
  });

  it("covers each declared flow kind", () => {
    // Every key in FLOW_PATH must round-trip through stagePath, so a new
    // flow stage can't be added to the type without a path.
    for (const kind of Object.keys(FLOW_PATH) as FlowStage["kind"][]) {
      const stage = { kind } as unknown as AppStage;
      expect(stagePath(stage)).toBe(FLOW_PATH[kind]);
    }
  });
});

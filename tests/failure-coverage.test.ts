/**
 * Pure-helper tests for the w3spay failure-mode coverage refactor.
 *
 * Each section locks one decision boundary from `local://w3spay-failure-coverage.md`:
 *  - `derivePayErrorStage`          → I4 catch routing on auth state.
 *  - `resolveMerchantStageAfterLoad` → C4 merchant-table drain mapping.
 *  - `unknownMerchantCopy`          → I5 NotInPilotScreen copy branch.
 *  - `staleMerchantsCopy`           → I2 banner visibility / copy by source.
 *  - `coinPaymentHostStatus`        → I1 host poll status reducer.
 */

import { describe, expect, it } from "vitest";

import {
  derivePayErrorStage,
  resolveMerchantStageAfterLoad,
  type QueuedMerchantScan,
} from "@/features/payment/lib/stage.ts";
import { unknownMerchantCopy } from "@/features/merchants/components/NotInPilotScreen.tsx";
import { staleMerchantsCopy } from "@/features/merchants/components/StaleMerchantsBanner.tsx";
import {
  coinPaymentHostStatus,

} from "@/features/host/api/coin-payment-host.ts";
import type { HostAuthState } from "@/features/host/api/host-auth.ts";
import type { MerchantEntry, MerchantTable } from "@/features/merchants/types.ts";
import type { ParsedTseQr } from "@/features/scan/lib/tse-parser.ts";

const PARSED: ParsedTseQr = {
  amountCents: 1234,
  kassenSerial: "TSE-001",
  transactionNumber: "42",
  signatureCounter: "7",
  sigAlgorithm: "ecdsa-plain-SHA384",
  startTime: "2026-01-01T00:00:00.000Z",
  logTime: "2026-01-01T00:00:01.000Z",
  logTimeFormat: "unixt",
  processType: "Kassenbeleg-V1",
  vatBreakdownCents: {
    vat19Cents: 1234,
    vat7Cents: 0,
    vatExemptCents: 0,
    vat19PartCents: 0,
    vatReducedCents: 0,
  },
  signatureBase64: "sig",
  publicKeyBase64: "pk",
};

const MERCHANT: MerchantEntry = {
  merchantId: "funkhaus",
  terminalId: "TSE-001",
  destination: {
    kind: "accountId32",
    value: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  displayName: "Funkhaus, Berlin",
  status: "active",
  addedAt: "2025-12-01T00:00:00.000Z",
};

const CONNECTED: HostAuthState = { kind: "connected" };

describe("derivePayErrorStage", () => {
  it("routes to needsLogin when auth flipped to disconnected mid-payment", () => {
    // The catch reads the freshest auth state via a ref; a sign-out
    // during `paying` must surface the real reason instead of a
    // generic "Payment couldn't go through".
    const stage = derivePayErrorStage(
      new Error("any host error"),
      { kind: "disconnected" },
      PARSED,
      MERCHANT,
      0,
    );
    expect(stage).toEqual({ kind: "needsLogin" });
  });

  it("routes to hostUnavailable when auth went outsideHost mid-payment", () => {
    const stage = derivePayErrorStage(
      new Error("host went away"),
      { kind: "outsideHost" },
      PARSED,
      MERCHANT,
      100,
    );
    expect(stage).toMatchObject({
      kind: "hostUnavailable",
    });
  });

  it("routes to hostUnavailable when auth went into an error state", () => {
    const stage = derivePayErrorStage(
      new Error("bridge crashed"),
      { kind: "error", reason: "boom" },
      PARSED,
      MERCHANT,
      0,
    );
    expect(stage).toMatchObject({ kind: "hostUnavailable" });
  });

  it("maps a standard-host InsufficientBalance error onto its messageFor copy in payError", () => {
    // The standard host payment manager rejects with a SCALE
    // `PaymentRequestErr::InsufficientBalance` CodecError (an `Error`
    // whose `.name` is the fully-qualified variant).
    const exception = Object.assign(new Error("insufficient balance"), {
      name: "PaymentRequestErr::InsufficientBalance",
    });
    const stage = derivePayErrorStage(exception, CONNECTED, PARSED, MERCHANT, 0);
    expect(stage.kind).toBe("payError");
    if (stage.kind !== "payError") throw new Error("unreachable");
    expect(stage.message).toBe("Not enough balance. Top up and try again.");
    expect(stage.parsed).toBe(PARSED);
    expect(stage.merchant).toBe(MERCHANT);
    expect(stage.tipCents).toBe(0);
  });

  it("falls back to a generic message for an unrecognized throw", () => {
    const stage = derivePayErrorStage(
      new Error("some random rejection"),
      CONNECTED,
      PARSED,
      MERCHANT,
      50,
    );
    expect(stage).toMatchObject({
      kind: "payError",
      message: "Payment couldn't go through. Try again.",
      tipCents: 50,
    });
  });
});

describe("resolveMerchantStageAfterLoad", () => {
  const queuedNoIdempotency: QueuedMerchantScan = {
    parsed: PARSED,
    existingPaymentId: null,
  };
  const queuedWithIdempotency: QueuedMerchantScan = {
    parsed: PARSED,
    existingPaymentId: "previous-payment-id",
  };
  const tableWithEntry: MerchantTable = {
    "funkhaus|TSE-001": MERCHANT,
  };
  const emptyTable: MerchantTable = {};

  it("returns null while the merchant table is still loading", () => {
    expect(
      resolveMerchantStageAfterLoad(
        null,
        queuedNoIdempotency,
        "funkhaus",
        false,
      ),
    ).toBeNull();
  });

  it("routes to unknownMerchant when the lookup misses", () => {
    expect(
      resolveMerchantStageAfterLoad(
        emptyTable,
        queuedNoIdempotency,
        "funkhaus",
        false,
      ),
    ).toEqual({
      kind: "unknownMerchant",
      parsed: PARSED,
    });
  });

  it("routes to alreadyPaid when the device's idempotency store had a hit", () => {
    const next = resolveMerchantStageAfterLoad(
      tableWithEntry,
      queuedWithIdempotency,
      "funkhaus",
      false,
    );
    expect(next).toEqual({
      kind: "alreadyPaid",
      parsed: PARSED,
      merchant: MERCHANT,
      existingPaymentId: "previous-payment-id",
    });
  });

  it("routes straight to confirm when tipScreen is disabled", () => {
    const next = resolveMerchantStageAfterLoad(
      tableWithEntry,
      queuedNoIdempotency,
      "funkhaus",
      false,
    );
    expect(next).toEqual({
      kind: "confirm",
      parsed: PARSED,
      merchant: MERCHANT,
      tipCents: 0,
    });
  });

  it("routes to tip when the tipScreen feature flag is on", () => {
    const next = resolveMerchantStageAfterLoad(
      tableWithEntry,
      queuedNoIdempotency,
      "funkhaus",
      true,
    );
    expect(next).toEqual({
      kind: "tip",
      parsed: PARSED,
      merchant: MERCHANT,
    });
  });
});

describe("unknownMerchantCopy", () => {
  it("returns the generic 'not on W3S Receipts yet' copy regardless of registry health", () => {
    const copy = unknownMerchantCopy();
    expect(copy.eyebrow).toBe("Not yet");
    expect(copy.headLead).toBe("This place isn't");
    expect(copy.headSuffix).toBe("on W3S Receipts yet.");
    expect(copy.sub.toLowerCase()).toContain("pilot");
  });
});

describe("staleMerchantsCopy", () => {
  it("hides the banner when not failed", () => {
    expect(staleMerchantsCopy(false)).toBeNull();
  });

  it("shows the banner when failed", () => {
    const copy = staleMerchantsCopy(true);
    expect(copy).not.toBeNull();
    expect(copy?.label.toLowerCase()).toContain("unreachable");
    expect(copy?.body.toLowerCase()).toContain("cached copy");
  });
});


describe("coinPaymentHostStatus", () => {
  it("is `ready` as soon as the bridge resolves, regardless of elapsed time", () => {
    expect(coinPaymentHostStatus(true, 0, 3_000)).toBe("ready");
    expect(coinPaymentHostStatus(true, 9_999, 3_000)).toBe("ready");
  });

  it("stays `pending` while the bridge isn't ready and the timeout hasn't elapsed", () => {
    expect(coinPaymentHostStatus(false, 100, 3_000)).toBe("pending");
    expect(coinPaymentHostStatus(false, 2_999, 3_000)).toBe("pending");
  });

  it("flips to `timeout` once elapsed crosses the configured timeout with no bridge", () => {
    expect(coinPaymentHostStatus(false, 3_000, 3_000)).toBe("timeout");
    expect(coinPaymentHostStatus(false, 9_999, 3_000)).toBe("timeout");
  });

  it("treats a non-positive timeout as immediate-timeout (total function, no edge case)", () => {
    expect(coinPaymentHostStatus(false, 0, 0)).toBe("timeout");
    expect(coinPaymentHostStatus(false, 0, -1)).toBe("timeout");
  });
});

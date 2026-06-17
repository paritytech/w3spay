import { describe, expect, it, vi } from "vitest";

import {
  isSaveReceiptUrl,
  parseSaveReceiptUrl,
  ReceiptParseError,
} from "@/features/scan/lib/receipt-parser.ts";
import { dispatchScannedPayload } from "@/features/scan/lib/dispatcher.ts";
import {
  findSaveReceiptDeepLink,
  persistSaveReceiptFromUrl,
} from "@/features/scan/lib/save-receipt-deeplink.ts";
import { useSessionStore } from "@/features/payment/store/session-store.ts";

const QUERY =
  "?v=1&id=01KTQ4VZJMGY2SKYNPDTTFJ034&a=14.50&as=CASH+TOKEN&c=EUR&t=19" +
  "&ts=2026-06-09T21%3A33%3A27.508Z&bn=Krusty+Krab+Pizza" +
  "&a1=12+Bikiini+Bottom&a2=12459+Berlin&tel=0112312312" +
  "&i=Pierogi+%288+St%C3%BCck%29%7C1%7C9.00&i=Bratkartoffeln%7C1%7C5.50&bk=566207";
const URL_STR = `polkadotapp://w3spay.dot/#/save-receipt${QUERY}`;

describe("isSaveReceiptUrl", () => {
  it("matches the canonical fragment form and the legacy path form", () => {
    expect(isSaveReceiptUrl(URL_STR)).toBe(true);
    expect(isSaveReceiptUrl("polkadotapp://w3spay.dot/save-receipt?v=1")).toBe(true);
    expect(isSaveReceiptUrl("polkadotapp://pay?address=x&amount=1")).toBe(false);
    expect(isSaveReceiptUrl("https://w3spay.dot/#/save-receipt?v=1")).toBe(false);
    expect(isSaveReceiptUrl('{"type":"t3rminal-receipt"}')).toBe(false);
  });
});

describe("parseSaveReceiptUrl", () => {
  it("parses short-key params into a typed receipt", () => {
    const r = parseSaveReceiptUrl(URL_STR);
    expect(r.saleId).toBe("01KTQ4VZJMGY2SKYNPDTTFJ034");
    expect(r.amountCents).toBe(1450);
    expect(r.asset).toBe("CASH TOKEN");
    expect(r.currency).toBe("EUR");
    expect(r.taxRatePercent).toBe(19);
    expect(r.business.name).toBe("Krusty Krab Pizza");
    expect(r.business.addressLine1).toBe("12 Bikiini Bottom");
    expect(r.items).toEqual([
      { name: "Pierogi (8 Stück)", quantity: 1, unitPriceCents: 900 },
      { name: "Bratkartoffeln", quantity: 1, unitPriceCents: 550 },
    ]);
    expect(r.blockNumber).toBe(566207);
  });

  it("parses an optional tip into tipCents and leaves it undefined when absent", () => {
    expect(parseSaveReceiptUrl(URL_STR).tipCents).toBeUndefined();
    expect(parseSaveReceiptUrl(`${URL_STR}&tp=2.50`).tipCents).toBe(250);
  });

  it("rejects a payload missing required params", () => {
    expect(() =>
      parseSaveReceiptUrl("polkadotapp://w3spay.dot/#/save-receipt?v=1&id=X"),
    ).toThrow(ReceiptParseError);
  });

  it("rejects an unsupported version", () => {
    let code = "";
    try {
      parseSaveReceiptUrl(URL_STR.replace("v=1", "v=2"));
    } catch (caught) {
      if (caught instanceof ReceiptParseError) code = caught.code;
    }
    expect(code).toBe("unsupportedVersion");
  });
});

describe("dispatchScannedPayload — in-app scanner path", () => {
  it("routes the save-receipt deeplink to the receipt branch", () => {
    const r = dispatchScannedPayload(URL_STR);
    expect(r.kind).toBe("receipt");
    if (r.kind === "receipt") {
      expect(r.payload.amountCents).toBe(1450);
      expect(r.payload.items).toHaveLength(2);
    }
  });

  it("routes an invalid deeplink to receiptInvalid (not unsupported)", () => {
    const r = dispatchScannedPayload("polkadotapp://w3spay.dot/#/save-receipt?v=1&id=X");
    expect(r.kind).toBe("receiptInvalid");
  });

  it("does not collide with the polkadotapp://pay terminal-pay deeplink", () => {
    expect(dispatchScannedPayload("polkadotapp://pay?address=x&amount=1").kind).not.toBe(
      "receipt",
    );
  });
});

describe("findSaveReceiptDeepLink — host-open boot path", () => {
  it("reads the payload from the search string", () => {
    expect(findSaveReceiptDeepLink(QUERY, "")?.receipt.saleId).toBe(
      "01KTQ4VZJMGY2SKYNPDTTFJ034",
    );
  });

  it("reads the payload from a hash-routed launch URL", () => {
    expect(findSaveReceiptDeepLink("", `#/save-receipt${QUERY}`)?.receipt.amountCents).toBe(
      1450,
    );
  });

  it("returns null without the id+v signature", () => {
    expect(findSaveReceiptDeepLink("?foo=1", "#/wallet")).toBeNull();
    expect(findSaveReceiptDeepLink("?v=1", "")).toBeNull();
  });

  it("returns null (logged) on a malformed payload", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(findSaveReceiptDeepLink("?v=1&id=X", "")).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("Polkadot host in-app browser contract", () => {
  it("keeps the route in the fragment so the SPA request path stays '/'", () => {
    const url = new URL(URL_STR);
    expect(url.pathname).toBe("/");
    expect(url.hash.startsWith("#/save-receipt")).toBe(true);
  });
});

describe("persistSaveReceiptFromUrl — warm /save-receipt navigation", () => {
  // The /save-receipt route's beforeLoad calls this when the host changes the
  // hash on an already-loaded SPA (the cold-start consumer only runs once).
  function withWindow(location: { search: string; hash: string }, run: () => void) {
    const globals = globalThis as { window?: unknown };
    const prev = globals.window;
    globals.window = { location };
    try {
      run();
    } finally {
      if (prev === undefined) delete globals.window;
      else globals.window = prev;
      useSessionStore.getState().resetScan();
    }
  }

  it("persists + seeds the receiptSaved flow from a hash-routed deeplink", () => {
    withWindow({ search: "", hash: `#/save-receipt${QUERY}` }, () => {
      expect(persistSaveReceiptFromUrl()).toBe(true);
      const flow = useSessionStore.getState().flow;
      expect(flow?.kind).toBe("receiptSaved");
      if (flow?.kind === "receiptSaved") {
        expect(flow.receipt.saleId).toBe("01KTQ4VZJMGY2SKYNPDTTFJ034");
      }
    });
  });

  it("reports false and seeds nothing when the URL carries no payload", () => {
    withWindow({ search: "", hash: "#/wallet" }, () => {
      expect(persistSaveReceiptFromUrl()).toBe(false);
      expect(useSessionStore.getState().flow).toBeNull();
    });
  });
});

import { describe, expect, it } from "vitest";

import { messageFromError, scaleErrReason } from "@/shared/utils/error-message.ts";

describe("messageFromError", () => {
  it("prefers payload.reason from a scale Err over the static error.message", () => {
    // Shape produced by `@novasamatech/scale`'s `Err` codec for
    // `PaymentRequestErr.Unknown`: static message, real reason on payload.
    const err = Object.assign(new Error("unknown error"), {
      name: "PaymentRequestErr",
      instance: "PaymentRequestErr::Unknown",
      payload: { reason: "merchant destination not on chain" },
    });
    expect(messageFromError(err, "fallback")).toBe(
      "merchant destination not on chain",
    );
  });

  it("falls back to error.message when no payload.reason", () => {
    expect(messageFromError(new Error("plain message"), "fallback")).toBe(
      "plain message",
    );
  });

  it("ignores empty payload.reason", () => {
    const err = Object.assign(new Error("static"), {
      payload: { reason: "" },
    });
    expect(messageFromError(err, "fallback")).toBe("static");
  });

  it("ignores non-string payload.reason", () => {
    const err = Object.assign(new Error("static"), {
      payload: { reason: 42 },
    });
    expect(messageFromError(err, "fallback")).toBe("static");
  });

  it("returns the fallback for non-Error values", () => {
    expect(messageFromError("oops", "fallback")).toBe("fallback");
    expect(messageFromError(null, "fallback")).toBe("fallback");
    expect(messageFromError(undefined, "fallback")).toBe("fallback");
  });

  it("returns the fallback when the error carries no message or reason", () => {
    expect(messageFromError(new Error(""), "fallback")).toBe("fallback");
  });
});

describe("scaleErrReason", () => {
  it("returns null for plain errors", () => {
    expect(scaleErrReason(new Error("x"))).toBeNull();
  });

  it("returns the payload reason when present and non-empty", () => {
    const err = Object.assign(new Error("static"), {
      payload: { reason: "real cause" },
    });
    expect(scaleErrReason(err)).toBe("real cause");
  });
});

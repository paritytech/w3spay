/**
 * Unit tests for the shared rear-camera primitive (`camera-stream.ts`).
 *
 * `acquireRearStream`, `acquireRearStreamWithRetry`,
 * `isTransientCameraError`, `shouldFailFast`, and `classifyStartError`
 * are the load-bearing decisions for the Android NotReadableError race
 * (the constraint cascade, the post-stop back-off, and the raw
 * DOMException → ScannerError mapping). Both the iOS (zxing-wasm) and
 * Android (qr-scanner) flows depend on them, so they're covered directly
 * here. The flow-specific `startZxingWasmScanner` /
 * `startQrScannerLibScanner` wrappers are live-DOM and exercised by
 * manual/device QA rather than here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireRearStream,
  acquireRearStreamWithRetry,
  classifyStartError,
  isTransientCameraError,
  shouldFailFast,
} from "@/features/scan/lib/camera-stream.ts";
import { ScannerError } from "@/features/scan/lib/scanner-types.ts";

type GetUserMediaImpl = (
  constraints?: MediaStreamConstraints,
) => Promise<MediaStream>;

function namedError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

function fakeStream(): MediaStream {
  // Minimal MediaStream stand-in — acquireRearStream only ever passes
  // the value through, so any non-null reference is fine.
  return {
    id: "fake-stream",
    active: true,
    getTracks: () => [],
    getVideoTracks: () => [],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

/**
 * Install a fake `navigator.mediaDevices` for the duration of one test.
 * Returns the `getUserMedia` spy so the test can assert call counts and
 * constraint shapes.
 */
function installFakeMediaDevices(impl: GetUserMediaImpl) {
  const spy = vi.fn(impl);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: spy } },
  });
  return spy;
}

const originalNavigator = (globalThis as { navigator?: unknown }).navigator;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalNavigator === undefined) {
    delete (globalThis as { navigator?: unknown }).navigator;
  } else {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  }
});

describe("acquireRearStream", () => {
  it("returns the stream from a single bare facingMode:environment request", async () => {
    const stream = fakeStream();
    const getUserMedia = installFakeMediaDevices(() => Promise.resolve(stream));
    const result = await acquireRearStream();
    expect(result).toEqual({ ok: true, stream });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    // No tiers, no `{ ideal: ... }` widths. Just rear camera, no audio.
    expect(getUserMedia.mock.calls[0]?.[0]).toEqual({
      audio: false,
      video: { facingMode: "environment" },
    });
  });

  it("returns the raw error verbatim on rejection", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const getUserMedia = installFakeMediaDevices(() =>
      Promise.reject(namedError("NotAllowedError", "denied")),
    );
    const result = await acquireRearStream();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error?.name).toBe("NotAllowedError");
      expect(result.error?.message).toBe("denied");
    }
    // Single attempt — no tier cascade to walk through.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("wraps a thrown non-Error into a real Error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    installFakeMediaDevices(() => Promise.reject("camera fell off") as Promise<MediaStream>);
    const result = await acquireRearStream();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe("camera fell off");
    }
  });

  it("returns a typed failure when navigator.mediaDevices is unavailable", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });
    const result = await acquireRearStream();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error?.message).toMatch(/getUserMedia is not available/);
    }
  });
});

describe("isTransientCameraError", () => {
  it("flags NotReadableError as transient (post-stop busy window)", () => {
    expect(isTransientCameraError(namedError("NotReadableError", "busy"))).toBe(true);
  });
  it("flags AbortError as transient (older-WebKit spelling of the same race)", () => {
    expect(isTransientCameraError(namedError("AbortError", "aborted"))).toBe(true);
  });
  it("does not flag terminal failures as transient", () => {
    expect(isTransientCameraError(namedError("NotAllowedError", "denied"))).toBe(false);
    expect(isTransientCameraError(namedError("NotFoundError", "no camera"))).toBe(false);
    expect(isTransientCameraError(namedError("OverconstrainedError", "no"))).toBe(false);
    expect(isTransientCameraError(new Error("anything else"))).toBe(false);
    expect(isTransientCameraError("not even an error")).toBe(false);
    expect(isTransientCameraError(null)).toBe(false);
  });
});

describe("acquireRearStreamWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries NotReadableError up to the back-off schedule's length", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stream = fakeStream();
    let calls = 0;
    const getUserMedia = installFakeMediaDevices(() => {
      calls += 1;
      // First three calls hit NotReadableError; the fourth resolves. The
      // back-off schedule has 3 steps, so 3 retries drive us to the
      // resolving 4th call. (One getUserMedia per acquire pass now that
      // the tier cascade is gone.)
      if (calls < 4) {
        return Promise.reject(namedError("NotReadableError", `busy attempt ${calls}`));
      }
      return Promise.resolve(stream);
    });
    const promise = acquireRearStreamWithRetry();
    // Drive the 3-step back-off schedule. Vitest's fake-timers need an
    // `await` between each to let the promise microtasks settle before
    // the next tick.
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result).toEqual({ ok: true, stream });
    // Initial + 3 retries = 4 calls.
    expect(getUserMedia).toHaveBeenCalledTimes(4);
  });

  it("does NOT retry NotAllowedError — permission denial is terminal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const getUserMedia = installFakeMediaDevices(() =>
      Promise.reject(namedError("NotAllowedError", "denied")),
    );
    const result = await acquireRearStreamWithRetry();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error?.name).toBe("NotAllowedError");
    // One call: NotAllowedError isn't transient, so the retry wrapper
    // returns immediately.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("returns immediately on success without burning any back-off", async () => {
    const stream = fakeStream();
    const getUserMedia = installFakeMediaDevices(() => Promise.resolve(stream));
    const result = await acquireRearStreamWithRetry();
    expect(result).toEqual({ ok: true, stream });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting the back-off schedule", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const getUserMedia = installFakeMediaDevices(() =>
      Promise.reject(namedError("NotReadableError", "still busy")),
    );
    const promise = acquireRearStreamWithRetry();
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error?.name).toBe("NotReadableError");
    // Initial + 3 retries = 4 calls.
    expect(getUserMedia).toHaveBeenCalledTimes(4);
  });
});

describe("shouldFailFast", () => {
  it("flags denied permission as terminal", () => {
    expect(shouldFailFast(namedError("NotAllowedError", "denied"))).toBe(true);
  });

  it("flags missing camera and security errors as terminal", () => {
    expect(shouldFailFast(namedError("NotFoundError", "no camera"))).toBe(true);
    expect(shouldFailFast(namedError("SecurityError", "blocked"))).toBe(true);
  });

  it("flags the missing-API sentinel by message", () => {
    expect(
      shouldFailFast(new Error("getUserMedia is not available in this runtime")),
    ).toBe(true);
  });

  it("falls through (returns false) for recoverable errors so qr-scanner's fallback runs", () => {
    expect(shouldFailFast(namedError("OverconstrainedError", "no"))).toBe(false);
    expect(shouldFailFast(namedError("NotReadableError", "busy"))).toBe(false);
    expect(shouldFailFast(namedError("AbortError", "aborted"))).toBe(false);
    expect(shouldFailFast(new Error("anything else"))).toBe(false);
  });
});

describe("classifyStartError", () => {
  it("maps NotAllowedError to permissionDenied", () => {
    const err = classifyStartError(namedError("NotAllowedError", "denied"));
    expect(err).toBeInstanceOf(ScannerError);
    expect(err.code).toBe("permissionDenied");
  });

  it("maps NotFoundError / OverconstrainedError / NotReadableError to cameraUnavailable", () => {
    expect(classifyStartError(namedError("NotFoundError", "no")).code).toBe(
      "cameraUnavailable",
    );
    expect(classifyStartError(namedError("OverconstrainedError", "no")).code).toBe(
      "cameraUnavailable",
    );
    expect(classifyStartError(namedError("NotReadableError", "busy")).code).toBe(
      "cameraUnavailable",
    );
  });

  it("maps qr-scanner's bare 'Camera not found.' string to cameraUnavailable", () => {
    expect(classifyStartError("Camera not found.").code).toBe("cameraUnavailable");
  });

  it("falls back to startFailed for unrecognised errors", () => {
    expect(classifyStartError(new Error("something else entirely")).code).toBe(
      "startFailed",
    );
  });

  it("preserves the original cause for debugging", () => {
    const cause = namedError("NotAllowedError", "denied");
    expect(classifyStartError(cause).cause).toBe(cause);
  });
});

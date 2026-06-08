/**
 * Session cache for `requestCameraPermission()`.
 *
 * The user-reported bug: a single happy-path receipt-save journey fires
 * up to 3 host camera modals. Cause: the host SDK is not guaranteed
 * idempotent across every platform, and we call `requestCameraPermission`
 * multiple times per session (boot probe, scanner mount, scanner remount).
 *
 * These tests pin the cache invariants:
 *   - First call probes the host; the result is captured.
 *   - Subsequent calls return the cached `true` without touching the SDK.
 *   - Concurrent callers share one in-flight SDK call.
 *   - Denials are NOT cached — a retry from CameraDeniedScreen must
 *     re-probe (and the explicit `resetCameraPermissionCache` clears any
 *     prior grant).
 *   - Outside a host returns `true` immediately without invoking the SDK
 *     — the browser's native `getUserMedia` prompt is the right surface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestDevicePermission: vi.fn(),
}));

vi.mock("@novasamatech/host-api-wrapper", () => ({
  // Caller surface exercised by `connection.ts`. The other re-exports
  // are unused on this test path.
  requestDevicePermission: mocks.requestDevicePermission,
  hostApi: {},
  requestPermission: vi.fn(),
  sandboxProvider: { isCorrectEnvironment: () => false },
  sandboxTransport: { isReady: () => Promise.resolve() },
  createAccountsProvider: vi.fn(() => ({})),
  injectSpektrExtension: vi.fn(),
}));
vi.mock("@novasamatech/host-api", () => ({
  enumValue: (tag: string, value: unknown) => ({ tag, value }),
}));

import {
  __resetHostConnectionForTests,
  requestCameraPermission,
  resetCameraPermissionCache,
} from "@/shared/api/host/connection.ts";

/** Mimic neverthrow `Result.ok(value).match(onOk, onErr)` shape. */
function okResult<T>(value: T) {
  return Promise.resolve({
    match: <R,>(onOk: (v: T) => R, _onErr: (e: unknown) => R): R => onOk(value),
  });
}

/** Mimic neverthrow `Result.err({ reason }).match(onOk, onErr)` shape. */
function errResult(reason: string) {
  return Promise.resolve({
    match: <R,>(_onOk: (v: never) => R, onErr: (e: { reason: string }) => R): R =>
      onErr({ reason }),
  });
}

beforeEach(() => {
  // Make `isInHost()` true so the cache path actually runs. Without a
  // host the function short-circuits to `true` before any caching.
  vi.stubGlobal("window", { __HOST_WEBVIEW_MARK__: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetHostConnectionForTests();
  mocks.requestDevicePermission.mockReset();
});

describe("requestCameraPermission session cache", () => {
  it("first call probes the host SDK; second call returns from cache", async () => {
    mocks.requestDevicePermission.mockReturnValueOnce(okResult(true));

    const first = await requestCameraPermission();
    const second = await requestCameraPermission();

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(mocks.requestDevicePermission).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache denials — a denied result re-probes on the next call", async () => {
    mocks.requestDevicePermission.mockReturnValueOnce(okResult(false));
    mocks.requestDevicePermission.mockReturnValueOnce(okResult(true));

    const first = await requestCameraPermission();
    const second = await requestCameraPermission();

    expect(first).toBe(false);
    expect(second).toBe(true);
    expect(mocks.requestDevicePermission).toHaveBeenCalledTimes(2);
  });

  it("concurrent callers dedupe onto a single in-flight SDK call", async () => {
    mocks.requestDevicePermission.mockReturnValueOnce(okResult(true));

    const [a, b, c] = await Promise.all([
      requestCameraPermission(),
      requestCameraPermission(),
      requestCameraPermission(),
    ]);

    expect([a, b, c]).toEqual([true, true, true]);
    expect(mocks.requestDevicePermission).toHaveBeenCalledTimes(1);
  });

  it("resetCameraPermissionCache forces the next call to re-probe", async () => {
    mocks.requestDevicePermission.mockReturnValueOnce(okResult(true));
    mocks.requestDevicePermission.mockReturnValueOnce(okResult(true));

    await requestCameraPermission();
    resetCameraPermissionCache();
    await requestCameraPermission();

    expect(mocks.requestDevicePermission).toHaveBeenCalledTimes(2);
  });

  it("does NOT cache transport errors — the next call retries the SDK", async () => {
    mocks.requestDevicePermission.mockReturnValueOnce(errResult("transport"));
    mocks.requestDevicePermission.mockReturnValueOnce(okResult(true));

    await expect(requestCameraPermission()).rejects.toThrow(
      /requestCameraPermission failed: transport/,
    );
    const second = await requestCameraPermission();

    expect(second).toBe(true);
    expect(mocks.requestDevicePermission).toHaveBeenCalledTimes(2);
  });

  it("returns true without invoking the SDK when outside a host", async () => {
    // Drop the host marker so `isInHost()` returns false.
    vi.unstubAllGlobals();

    const result = await requestCameraPermission();

    expect(result).toBe(true);
    expect(mocks.requestDevicePermission).not.toHaveBeenCalled();
  });
});

/**
 * Unit tests for the `isLiveScanHost` ghost guard.
 *
 * The guard is what stops a `<ScreenTransition>` leaving-slot copy of the
 * scan screen from opening a SECOND camera session and racing the live
 * scanner — the iOS `NotReadableError` bounce-to-retry bug. Each branch
 * below maps to one real reason a host is NOT a live scan surface.
 *
 * Tests run in the `node` environment (no DOM), so we drive the guard
 * with duck-typed host stand-ins exposing only the four members it reads:
 * `isConnected`, `closest`, `clientWidth`, `clientHeight`.
 */

import { describe, expect, it } from "vitest";

import { isLiveScanHost } from "@/features/scan/lib/scan-host.ts";

interface FakeHostOptions {
  isConnected?: boolean;
  /** When true, `closest('[aria-hidden="true"]')` resolves an ancestor. */
  insideAriaHidden?: boolean;
  clientWidth?: number;
  clientHeight?: number;
}

function fakeHost(options: FakeHostOptions = {}): HTMLElement {
  const {
    isConnected = true,
    insideAriaHidden = false,
    clientWidth = 344,
    clientHeight = 344,
  } = options;
  return {
    isConnected,
    clientWidth,
    clientHeight,
    closest(selector: string) {
      if (selector === '[aria-hidden="true"]' && insideAriaHidden) {
        return {} as Element;
      }
      return null;
    },
  } as unknown as HTMLElement;
}

describe("isLiveScanHost", () => {
  it("is false for a null host", () => {
    expect(isLiveScanHost(null)).toBe(false);
  });

  it("is false for a detached host (async start resolved after unmount)", () => {
    expect(isLiveScanHost(fakeHost({ isConnected: false }))).toBe(false);
  });

  it("is false for a transition ghost inside an aria-hidden leaving slot", () => {
    expect(isLiveScanHost(fakeHost({ insideAriaHidden: true }))).toBe(false);
  });

  it("is true regardless of box size — sizing is a layout bug, not a ghost signal", () => {
    // A connected, non-hidden host is live even if it reports a zero box
    // (e.g. a transient aspect-ratio reflow in a WebView). Gating on size
    // would hang the live scanner's spinner; the decoders don't need a
    // sized host. See scan-host.ts.
    expect(isLiveScanHost(fakeHost({ clientWidth: 0, clientHeight: 0 }))).toBe(true);
  });

  it("is true for a connected, non-hidden host", () => {
    expect(isLiveScanHost(fakeHost())).toBe(true);
  });
});

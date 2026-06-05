import { describe, expect, it } from "vitest";

import { computeDecodeCrop } from "@/features/scan/lib/backend-zxing-wasm.ts";

describe("computeDecodeCrop", () => {
  it("captures the central visible square and caps 4K frames at 2048px", () => {
    expect(computeDecodeCrop(2160, 3840, 1)).toEqual({
      sx: 0,
      sy: 840,
      sourceSide: 2160,
      targetSide: 2048,
    });
  });

  it("sweeps tighter central crops for dense QR payloads", () => {
    expect(computeDecodeCrop(2160, 3840, 0.64)).toEqual({
      sx: 389,
      sy: 1229,
      sourceSide: 1382,
      targetSide: 1382,
    });
  });

  it("keeps 1080p streams at native resolution instead of upscaling", () => {
    expect(computeDecodeCrop(1080, 1920, 1)).toEqual({
      sx: 0,
      sy: 420,
      sourceSide: 1080,
      targetSide: 1080,
    });
  });
});

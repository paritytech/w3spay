import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadEnvFile, readEnvKey, upsertEnvFile } from "../scripts/lib/env-files.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "envfiles-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("upsertEnvFile", () => {
  it("creates a file with the header comment then the keys", () => {
    const p = join(dir, ".env.local");
    upsertEnvFile(
      p,
      { VITE_NETWORK: "paseo-next-v2", VITE_W3SPAY_REGISTRY_ADDRESS: "0xabc" },
      { headerComment: "# header" },
    );
    expect(readFileSync(p, "utf8")).toBe(
      "# header\n\nVITE_NETWORK=paseo-next-v2\nVITE_W3SPAY_REGISTRY_ADDRESS=0xabc\n",
    );
  });

  it("replaces an existing key in place, preserving comments and unrelated keys", () => {
    const p = join(dir, ".env");
    writeFileSync(p, "# top comment\nKEEP=untouched\nTARGET=old\n# tail comment\n");
    upsertEnvFile(p, { TARGET: "new" });
    expect(readFileSync(p, "utf8")).toBe(
      "# top comment\nKEEP=untouched\nTARGET=new\n# tail comment\n",
    );
  });

  it("appends to a file lacking a trailing newline without gluing lines", () => {
    const p = join(dir, ".env");
    writeFileSync(p, "EXISTING=value");
    upsertEnvFile(p, { ADDED: "x" });
    expect(readFileSync(p, "utf8")).toBe("EXISTING=value\nADDED=x\n");
  });

  it("does not write the header comment when the file already exists", () => {
    const p = join(dir, ".env");
    writeFileSync(p, "A=1\n");
    upsertEnvFile(p, { B: "2" }, { headerComment: "# should not appear" });
    expect(readFileSync(p, "utf8")).toBe("A=1\nB=2\n");
  });
});

describe("readEnvKey", () => {
  it("returns the last occurrence of a key", () => {
    const p = join(dir, ".env");
    writeFileSync(p, "K=first\nK=second\n");
    expect(readEnvKey(p, "K")).toBe("second");
  });

  it("strips one layer of surrounding quotes", () => {
    const p = join(dir, ".env");
    writeFileSync(p, `Q="quoted value"\nS='single'\n`);
    expect(readEnvKey(p, "Q")).toBe("quoted value");
    expect(readEnvKey(p, "S")).toBe("single");
  });

  it("returns undefined for a missing key, an empty value, and a missing file", () => {
    const p = join(dir, ".env");
    writeFileSync(p, "PRESENT=1\nEMPTY=\n");
    expect(readEnvKey(p, "ABSENT")).toBeUndefined();
    expect(readEnvKey(p, "EMPTY")).toBeUndefined();
    expect(readEnvKey(join(dir, "missing.env"), "ANY")).toBeUndefined();
  });

  it("lets a later empty value override an earlier non-empty one (tail -n 1)", () => {
    const p = join(dir, ".env");
    writeFileSync(p, "K=value\nK=\n");
    expect(readEnvKey(p, "K")).toBeUndefined();
  });
});

describe("loadEnvFile", () => {
  const touched = ["LF_SET", "LF_PRESET", "LF_KV"];

  afterEach(() => {
    for (const k of touched) delete process.env[k];
  });

  it("sets unset keys but never overwrites a pre-set process.env key", () => {
    const p = join(dir, ".env");
    writeFileSync(p, "LF_SET=fromfile\nLF_PRESET=fromfile\n");
    process.env.LF_PRESET = "preset";
    loadEnvFile(p);
    expect(process.env.LF_SET).toBe("fromfile");
    expect(process.env.LF_PRESET).toBe("preset");
  });

  it("ignores comments and malformed lines", () => {
    const p = join(dir, ".env");
    writeFileSync(p, "# comment\nnot a kv line\n=noKey\nLF_KV=ok\n");
    loadEnvFile(p);
    expect(process.env.LF_KV).toBe("ok");
  });

  it("is a no-op for a missing file", () => {
    expect(() => loadEnvFile(join(dir, "missing.env"))).not.toThrow();
  });
});

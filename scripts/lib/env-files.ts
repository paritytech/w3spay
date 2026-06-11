import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Dotenv read/write helpers for the deploy wizard (scripts/setup.ts). ESM-safe
// and dependency-free: callers pass absolute paths so this module never reaches
// for __dirname / import.meta.

/** Strip a single layer of matching single/double quotes from a value. */
function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, "$2");
}

/**
 * Fill `process.env` from a dotenv file; keys already present in `process.env`
 * win (an exported shell var overrides the file). A missing file is a no-op.
 * Blank lines, `#` comments, and lines without a `KEY=` are skipped.
 */
export function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquote(trimmed.slice(equals + 1).trim());
  }
}

/**
 * Return the value of the last `KEY=` line in the dotenv file, trimmed with one
 * quote layer stripped. `undefined` when the file is missing, the key is
 * absent, or the resolved value is empty. Last-match-wins mirrors deploy.sh's
 * `tail -n 1` resolution so operator overrides at the bottom of a file take
 * effect.
 */
export function readEnvKey(path: string, key: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, "utf8");
  let found: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    if (trimmed.slice(0, equals).trim() !== key) continue;
    found = unquote(trimmed.slice(equals + 1).trim());
  }
  return found ? found : undefined;
}

/**
 * Idempotently merge `values` into the dotenv file at `path`, preserving
 * existing comments, blank lines, and unrelated keys. Writes `headerComment`
 * first when creating a new file.
 */
export function upsertEnvFile(
  path: string,
  values: Record<string, string>,
  options: { headerComment?: string } = {},
): void {
  let content = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (content === "" && options.headerComment) {
    content = `${options.headerComment.replace(/\n*$/, "\n")}\n`;
  }
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=.*$`, "m");
    if (re.test(content)) content = content.replace(re, line);
    else {
      if (content.length && !content.endsWith("\n")) content += "\n";
      content += `${line}\n`;
    }
  }
  writeFileSync(path, content);
}

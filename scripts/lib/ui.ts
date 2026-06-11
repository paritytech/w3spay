import { createInterface, type Interface } from "node:readline/promises";

// Dependency-free terminal UI for the deploy wizard (scripts/setup.ts): ANSI
// colors that no-op outside a TTY, status lines, and lazily-created prompts
// over node:readline/promises. The wizard only calls the prompts in
// interactive mode; the non-TTY guard is a safety net, not a path.

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function paint(code: string): (s: string) => string {
  return (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
}

export const c = {
  dim: paint("2"),
  bold: paint("1"),
  green: paint("32"),
  yellow: paint("33"),
  red: paint("31"),
};

export function heading(s: string): void {
  console.log("");
  console.log(c.bold(`── ${s} ──`));
}

export function log(s: string): void {
  console.log(s);
}

export function blank(): void {
  console.log("");
}

export function bullet(s: string): void {
  console.log(`  • ${s}`);
}

export function success(s: string): void {
  console.log(c.green(` ✓ ${s}`));
}

export function warn(s: string): void {
  console.log(c.yellow(` ⚠ ${s}`));
}

export function error(s: string): void {
  console.error(c.red(` ✗ ${s}`));
}

let rl: Interface | undefined;

function getRl(): Interface {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
    process.once("exit", closeUi);
  }
  return rl;
}

/** Close the shared readline interface so the process can exit cleanly. */
export function closeUi(): void {
  rl?.close();
  rl = undefined;
}

function requireTty(): void {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Interactive prompt requested without a TTY. Re-run with --yes and set the " +
        "required values in .env.local for non-interactive mode.",
    );
  }
}

export async function confirm(question: string, def: boolean): Promise<boolean> {
  requireTty();
  const hint = def ? "(Y/n)" : "(y/N)";
  const answer = (await getRl().question(`${c.bold(question)} ${c.dim(hint)} `)).trim().toLowerCase();
  if (!answer) return def;
  return answer === "y" || answer === "yes";
}

export async function text(
  question: string,
  opts: { default?: string; validate?: (v: string) => string | null } = {},
): Promise<string> {
  requireTty();
  const suffix = opts.default ? c.dim(` [${opts.default}]`) : "";
  for (;;) {
    const raw = (await getRl().question(`${c.bold(question)}${suffix} `)).trim();
    const value = raw || opts.default || "";
    if (opts.validate) {
      const message = opts.validate(value);
      if (message) {
        warn(message);
        continue;
      }
    }
    return value;
  }
}

export async function select(
  question: string,
  options: Array<{ label: string; value: string; hint?: string }>,
): Promise<string> {
  requireTty();
  if (options.length === 0) throw new Error("select() requires at least one option");
  log(c.bold(question));
  options.forEach((opt, i) => {
    const hint = opt.hint ? c.dim(` — ${opt.hint}`) : "";
    log(`  ${i + 1}) ${opt.label}${hint}`);
  });
  for (;;) {
    const raw = (await getRl().question(c.dim(`Select 1-${options.length} [1] `))).trim();
    if (!raw) return options[0]!.value;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1]!.value;
    warn(`Enter a number between 1 and ${options.length}.`);
  }
}

export async function password(question: string): Promise<string> {
  requireTty();
  const iface = getRl() as unknown as {
    _writeToOutput?: (this: unknown, s: string) => void;
  };
  const original = iface._writeToOutput;
  let muted = false;
  iface._writeToOutput = function (this: unknown, str: string) {
    // The prompt is written synchronously by question() before we mute, so it
    // still renders; once muted we swallow the echo of every typed character.
    if (!muted) original?.call(this, str);
  };
  const pending = getRl().question(`${c.bold(question)} `);
  muted = true;
  try {
    return await pending;
  } finally {
    iface._writeToOutput = original;
    process.stdout.write("\n");
  }
}

/**
 * Guided one-command deploy for w3spay.
 *
 * Runs the whole pipeline from a single repo-root `.env.local`:
 *   environment → configure → readiness → build + publish.
 *
 * `deploy.sh` stays the workhorse; this wizard orchestrates it. POSIX only —
 * it spawns `bash deploy.sh` and `npm`. This app only *consumes* the on-chain
 * W3SPayRegistry (published by w3spay-admin), so there is no contract-deploy
 * or admin-grant phase here.
 *
 *   npm run setup                                  # interactive
 *   npm run setup -- --network paseo-next-v2 --yes # non-interactive
 *   npm run setup -- --dry-run                     # checks only, writes nothing
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveNetwork, SUPPORTED_NETWORKS, type NetworkConfig } from "../src/shared/api/host/networks";
import { loadEnvFile, upsertEnvFile } from "./lib/env-files";
import * as ui from "./lib/ui";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const ENV_LOCAL = resolve(REPO_ROOT, ".env.local");
const ENV_FILE = resolve(REPO_ROOT, ".env");
const MIN_BULLETIN_DEPLOY = "0.10.0";
const RPC_TIMEOUT_MS = 10_000;
const DEFAULT_NETWORK_KEY = "paseo-next-v2";

export interface SetupFlags {
  network?: string;
  yes: boolean;
  dryRun: boolean;
  domain?: string;
  publish?: boolean;
}

interface Config {
  networkKey: string;
  network: NetworkConfig;
  domain: string;
  registryAddress?: `0x${string}`;
  publishMnemonic?: string;
  publishToBrowse: boolean;
  persistSecrets: boolean;
}

/** A check the operator must fix before the deploy can proceed. */
class BlockedError extends Error {}

// ─── Pure helpers (unit-tested) ────────────────────────────────────────────

export function parseFlags(argv: string[]): SetupFlags {
  const flags: SetupFlags = { yes: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--network":
      case "--env":
        flags.network = argv[i + 1];
        i += 1;
        break;
      case "--domain":
        flags.domain = argv[i + 1];
        i += 1;
        break;
      case "--yes":
      case "-y":
      case "--non-interactive":
        flags.yes = true;
        break;
      case "--dry-run":
        flags.dryRun = true;
        break;
      case "--publish":
        flags.publish = true;
        break;
      case "--no-publish":
        flags.publish = false;
        break;
      default:
        break;
    }
  }
  return flags;
}

export function isValidRegistryAddress(v: string | undefined): v is `0x${string}` {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

/** Append `.dot` unless already suffixed (mirrors deploy.sh). */
export function normalizeDomain(v: string): string {
  return v.endsWith(".dot") ? v : `${v}.dot`;
}

export function mnemonicWordCount(v: string): number {
  const trimmed = v.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Read a dotenv-style boolean: `true`/`1`/`yes` (case-insensitive) → true. */
export function parsePublishFlag(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function versionGte(current: string, minimum: string): boolean {
  const cur = current.split(".").map(Number);
  const min = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const a = cur[i] ?? 0;
    const b = min[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

function probeWsReachable(wsUrl: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolveProbe, reject) => {
    const socket = new WebSocket(wsUrl);
    let timer: ReturnType<typeof setTimeout>;
    const settle = (action: () => void): void => {
      clearTimeout(timer);
      socket.onopen = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // Socket may already be closing; nothing to clean up.
      }
      action();
    };
    timer = setTimeout(() => settle(() => reject(new Error(`RPC probe timed out after ${timeoutMs}ms`))), timeoutMs);
    timer.unref?.();
    socket.onopen = () => settle(resolveProbe);
    socket.onerror = () => settle(() => reject(new Error("WebSocket connection failed")));
  });
}

// ─── Phases ────────────────────────────────────────────────────────────────

function phaseEnvironment(): void {
  ui.heading("Environment");
  const blockers: string[] = [];
  const bulletinFix = "npm install -g bulletin-deploy@latest";

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor >= 22) ui.success(`Node ${process.versions.node}`);
  else {
    ui.error(`Node ${process.versions.node} — need >= 22`);
    blockers.push("Upgrade Node to >= 22.");
  }

  const probe = spawnSync("bulletin-deploy", ["--version"], { encoding: "utf8", stdio: "pipe" });
  const found = (probe.stdout ?? "").match(/([0-9]+)\.([0-9]+)\.([0-9]+)/)?.[0];
  if (probe.error || probe.status !== 0 || !found) {
    ui.error("bulletin-deploy not found on PATH");
    blockers.push(bulletinFix);
  } else if (versionGte(found, MIN_BULLETIN_DEPLOY)) {
    ui.success(`bulletin-deploy ${found}`);
  } else {
    ui.error(`bulletin-deploy ${found} < ${MIN_BULLETIN_DEPLOY}`);
    blockers.push(bulletinFix);
  }

  if (blockers.length) {
    throw new BlockedError(`Environment checks failed:\n${blockers.map((b) => `   - ${b}`).join("\n")}`);
  }
}

async function resolveNetworkKey(flags: SetupFlags): Promise<string> {
  let key = flags.network ?? process.env.VITE_NETWORK;
  if (!key) {
    if (flags.yes) key = DEFAULT_NETWORK_KEY;
    else
      key = await ui.select(
        "Network",
        SUPPORTED_NETWORKS.map((k) => ({
          label: k,
          value: k,
          hint: k === DEFAULT_NETWORK_KEY ? "recommended" : undefined,
        })),
      );
  }
  if (!(SUPPORTED_NETWORKS as string[]).includes(key)) {
    throw new BlockedError(`Unknown network "${key}". Valid: ${SUPPORTED_NETWORKS.join(", ")}.`);
  }
  return key;
}

async function phaseConfigure(flags: SetupFlags): Promise<Config> {
  ui.heading("Configure");
  loadEnvFile(ENV_LOCAL);
  loadEnvFile(ENV_FILE);

  const networkKey = await resolveNetworkKey(flags);
  let network: NetworkConfig;
  try {
    network = resolveNetwork(networkKey, {
      mainGenesisHash: process.env.VITE_CHAIN_GENESIS_HASH,
      bulletinGenesisHash: process.env.VITE_BULLETIN_GENESIS_HASH,
    });
  } catch (e) {
    throw new BlockedError((e as Error).message);
  }

  let domain = "";
  const domainInput = flags.domain ?? process.env.VITE_DOTNS_PRODUCT_DOMAIN;
  if (domainInput) domain = normalizeDomain(domainInput);
  else if (flags.dryRun) ui.warn("VITE_DOTNS_PRODUCT_DOMAIN not set — would block a real run.");
  else if (flags.yes) {
    throw new BlockedError(
      "No target domain. Pass --domain <name> or set VITE_DOTNS_PRODUCT_DOMAIN in .env.local.",
    );
  } else {
    domain = normalizeDomain(
      await ui.text("Target .dot domain", {
        validate: (v) => (v.trim() ? null : "Enter a domain, e.g. w3spay.dot"),
      }),
    );
  }

  // Optional: src/config.ts carries a built-in default, so a blank value is valid.
  let registryAddress: `0x${string}` | undefined;
  const existingRegistry = process.env.VITE_W3SPAY_REGISTRY_ADDRESS;
  if (isValidRegistryAddress(existingRegistry)) registryAddress = existingRegistry;
  else if (existingRegistry) {
    throw new BlockedError(`VITE_W3SPAY_REGISTRY_ADDRESS="${existingRegistry}" is not a valid H160 (0x + 40 hex).`);
  } else if (!flags.yes && !flags.dryRun) {
    const entered = (await ui.text("W3SPayRegistry address (blank = built-in default)")).trim();
    if (entered) {
      if (!isValidRegistryAddress(entered)) {
        throw new BlockedError(`"${entered}" is not a valid H160 (0x + 40 hex).`);
      }
      registryAddress = entered;
    }
  }

  const dotns = (process.env.DOTNS_MNEMONIC ?? "").trim().replace(/\s+/g, " ");
  const mnem = (process.env.MNEMONIC ?? "").trim().replace(/\s+/g, " ");
  if (dotns && mnem && dotns !== mnem) {
    throw new BlockedError("DOTNS_MNEMONIC and MNEMONIC are both set but differ. Unset the stale one in .env.local.");
  }
  let publishMnemonic = dotns || mnem || undefined;
  let prompted = false;
  if (!publishMnemonic) {
    if (flags.dryRun) ui.warn("MNEMONIC not set — would block a real run.");
    else if (flags.yes) {
      throw new BlockedError("MNEMONIC (or DOTNS_MNEMONIC) is not set in .env.local (required to publish in --yes mode).");
    } else {
      publishMnemonic = await ui.password("Publisher mnemonic (MNEMONIC)");
      prompted = true;
    }
  }
  if (publishMnemonic) validateMnemonic(publishMnemonic, "Publisher mnemonic");

  const publishDefault = flags.publish ?? parsePublishFlag(process.env.BULLETIN_DEPLOY_PUBLISH);
  let publishToBrowse = publishDefault;
  if (flags.publish === undefined && !flags.yes && !flags.dryRun) {
    publishToBrowse = await ui.confirm(
      "Publish to the Browse directory? (lists the .dot in the on-chain Publisher registry; paseo-next-v2 only)",
      publishDefault,
    );
  }

  let persistSecrets = false;
  if (prompted && !flags.dryRun) {
    persistSecrets = await ui.confirm("Save secrets to .env.local (gitignored)?", true);
  }

  const cfg: Config = {
    networkKey,
    network,
    domain,
    registryAddress,
    publishMnemonic,
    publishToBrowse,
    persistSecrets,
  };

  reviewConfig(cfg);
  if (!flags.yes && !flags.dryRun) {
    if (!(await ui.confirm("Save choices to .env.local and continue?", true))) {
      throw new BlockedError("Aborted at review.");
    }
  }

  if (!flags.dryRun) {
    const values: Record<string, string> = {
      VITE_NETWORK: networkKey,
      BULLETIN_DEPLOY_PUBLISH: publishToBrowse ? "true" : "false",
    };
    if (domain) values.VITE_DOTNS_PRODUCT_DOMAIN = domain;
    if (registryAddress) values.VITE_W3SPAY_REGISTRY_ADDRESS = registryAddress;
    if (persistSecrets && publishMnemonic) values.MNEMONIC = publishMnemonic;
    upsertEnvFile(ENV_LOCAL, values, {
      headerComment: "# Local-only env for w3spay. Gitignored — never commit secrets.",
    });
  }

  return cfg;
}

function validateMnemonic(seed: string, label: string): void {
  const words = mnemonicWordCount(seed);
  if (words !== 12 && words !== 24) {
    throw new BlockedError(`${label} has ${words} words; expected 12 or 24.`);
  }
}

function reviewConfig(cfg: Config): void {
  ui.blank();
  ui.log(ui.c.bold("Review"));
  ui.bullet(`Network:   ${cfg.network.displayName} (${cfg.networkKey})`);
  ui.bullet(`Domain:    ${cfg.domain || ui.c.dim("(not set)")}`);
  ui.bullet(`Registry:  ${cfg.registryAddress ?? ui.c.dim("built-in default (src/config.ts)")}`);
  ui.bullet(`Publish:   ${cfg.publishToBrowse ? "yes — list in Browse directory" : "no (upload only)"}`);
}

async function phaseReadiness(cfg: Config, flags: SetupFlags): Promise<void> {
  ui.heading("Readiness");
  const wsUrl = cfg.network.mainChain.wsUrl;
  const blockers: string[] = [];
  try {
    await probeWsReachable(wsUrl, RPC_TIMEOUT_MS);
    ui.success(`Asset Hub RPC reachable (${wsUrl})`);
  } catch {
    ui.error(`Asset Hub RPC unreachable (${wsUrl})`);
    blockers.push(`Check connectivity to ${wsUrl}`);
  }

  if (blockers.length) {
    throw new BlockedError(`Readiness checks failed:\n${blockers.map((b) => `   - ${b}`).join("\n")}`);
  }
  if (!flags.yes && !flags.dryRun) {
    if (!(await ui.confirm("Continue?", true))) throw new BlockedError("Aborted at readiness.");
  }
}

function phaseApp(cfg: Config): void {
  ui.heading("Build & publish");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BULLETIN_ENV: cfg.networkKey,
    VITE_NETWORK: cfg.networkKey,
    BULLETIN_DEPLOY_PUBLISH: cfg.publishToBrowse ? "true" : "false",
  };
  if (cfg.registryAddress) env.VITE_W3SPAY_REGISTRY_ADDRESS = cfg.registryAddress;
  if (cfg.publishMnemonic) env.MNEMONIC = cfg.publishMnemonic;
  const res = spawnSync("bash", ["deploy.sh", cfg.domain], { stdio: "inherit", cwd: REPO_ROOT, env });
  if (res.status !== 0) throw new BlockedError("App publish failed — see output above.");
}

function summary(cfg: Config): void {
  ui.heading(`✓ Deploy complete — ${cfg.networkKey}`);
  if (cfg.domain) {
    const name = cfg.domain.replace(/\.dot$/, "");
    const gateway = process.env.DOTNS_GATEWAY_BASE || "dot.li";
    ui.bullet(`App:      https://${name}.${gateway}`);
    if (cfg.publishToBrowse) ui.bullet("Listed in the Browse directory (Publisher registry).");
  }
  ui.blank();
  ui.log(ui.c.dim("Next steps:"));
  ui.log(ui.c.dim("  • Open the app inside a Polkadot host to use it."));
  ui.log(ui.c.dim("  • Re-run `npm run setup` to redeploy with the same choices."));
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  ui.blank();
  ui.log(ui.c.bold("w3spay deploy"));
  ui.log(ui.c.dim(flags.dryRun ? "Dry run — checks only, no changes." : "Guided one-command deploy."));

  phaseEnvironment();
  const cfg = await phaseConfigure(flags);
  await phaseReadiness(cfg, flags);

  if (flags.dryRun) {
    ui.blank();
    ui.success("Dry-run complete — environment, config, and readiness checked. No changes made.");
    return;
  }

  phaseApp(cfg);
  summary(cfg);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return entry === self;
  }
}

if (isMainModule()) {
  main()
    .then(() => ui.closeUi())
    .catch((err: unknown) => {
      ui.closeUi();
      ui.blank();
      if (err instanceof BlockedError) ui.error(err.message);
      else ui.error(`Unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      process.exit(1);
    });
}

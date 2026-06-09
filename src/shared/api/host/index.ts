// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * `@/sdk/host` — shared building blocks for products that run inside a
 * Polkadot host (Desktop webview, dotli iframe, native mobile) or standalone.
 *
 *   - `./networks`             — per-network chain registry + env resolver
 *   - `./connection`           — host detection + AccountsProvider singleton
 *   - `./client`               — PAPI client cache keyed by genesis hash
 *   - `./host-api`             — single facade over the Host API wrapper
 *   - `./host-tx-signer`       — host-mode signer (handles custom signed
 *                                extensions like AsPgas)
 *   - `./wallet`               — auto-initing React store: connection state,
 *                                product account, signer
 *   - `./debug`                — toolbox-button debug overlay for mobile hosts
 */

export * from "./networks.ts";
export * from "./connection.ts";
export * from "./client.ts";
export * from "./host-tx-signer.ts";
export * from "./host-api.ts";
export * from "./wallet.ts";
export * from "./permissions.ts";
export * as debug from "./debug/index.ts";

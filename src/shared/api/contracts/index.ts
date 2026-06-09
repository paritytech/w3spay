// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * `@/sdk/contracts` — generic pallet-revive contract helpers. Each takes a
 * `PolkadotClient` first so one module drives any chain; pass the same
 * client across coordinating helpers (the genesis-hash-keyed
 * `getOrCreateClient` cache makes this automatic at the app layer).
 */

export { readContract, type ReadContractOptions } from "./read.ts";

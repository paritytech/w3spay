/**
 * `@/sdk/host` — shared building blocks for products that run inside
 * a Polkadot host (Desktop webview, dotli iframe, native mobile) or
 * standalone in a browser tab.
 *
 * Concern areas:
 *   - `./networks`            — per-network chain registry + env-driven resolver
 *   - `./connection`          — host detection + AccountsProvider singleton
 *   - `./client`              — PAPI client cache keyed by genesis hash
 *   - `./host-api`            — single facade over the low-level Host API
 *                               (`@novasamatech/host-api-wrapper`). Owns the
 *                               module-level transport singleton; bundling
 *                               multiple physical copies would clobber the
 *                               Desktop webview `MessagePort.onmessage`
 *                               handler.
 *   - `./host-tx-signer`      — host-mode `PolkadotSigner` (handles custom
 *                               signed-extensions like AsPgas on Polkadot
 *                               Hub TestNet)
 *   - `./standalone-tx-signer` — browser-extension-mode `PolkadotSigner`
 *                               (Talisman, PJS, SubWallet)
 *   - `./wallet`              — auto-initing React store; the single source
 *                               of truth for connection state, product
 *                               account, signer, and allowance claims
 *   - `./debug`               — toolbox-button debug overlay for mobile-host
 *                               debugging; see `DebugPanel` and
 *                               `installConsoleCapture` in
 *                               `@/sdk/host/debug`
 */

export * from "./networks.ts";
export * from "./connection.ts";
export * from "./client.ts";
export * from "./host-tx-signer.ts";
export * from "./standalone-tx-signer.ts";
export * from "./host-api.ts";
export * from "./wallet.ts";
export * from "./permissions.ts";
export * as debug from "./debug/index.ts";

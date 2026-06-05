# W3SPay

Outside-venue Coinage receipt scanner. Built for the **Web3 Summit Berlin
pilot (18–19 June 2026)** at Funkhaus, and the surrounding pilot merchants
who never run any new software of their own.

A customer scans the QR on the merchant's normal German fiscal receipt
(BSI TR-03151 / KassenSichV §6), the app extracts the merchant's TSE
serial and the receipt total in EUR, looks the merchant up in a hardcoded
pilot table, and issues an [RFC 0006][rfc6] Coinage payment to that
merchant's smart-contract address. The customer hands the resulting
confirmation screen to the cashier; that's the entire UX.

[rfc6]: https://github.com/paritytech/triangle-js-sdks/pull/94

W3SPay will also support **t3rminal-issued payment QRs** as a second
scan source. When a merchant runs a t3rminal terminal, scanning its
deeplink lands on the same confirm screen, skips the TSE parser, and
resolves `(merchantId, terminalId)` against the on-chain
`W3SPayMerchantRegistry` directly. Same Coinage settlement leg,
different front door.

Forked from `repos/t3rminal/apps/merchant-terminal/`. Same Vite +
`product-sdk-pack` + `bulletin-deploy → .dot` shell; new UI + parser layer
on top. See `local://w3spay-prototype.md` for the design plan and `FINDINGS.md`
at the repo root for the upstream German-fiscalization research.

## Flow

```
┌──────────────────┐    ┌────────────────────┐    ┌──────────────┐
│ Any German       │ →  │ Fiscal receipt     │ ←─ │ Customer's   │
│ merchant's Kasse │    │ with TSE QR        │    │ Polkadot     │
│ — cashier rings  │    │ (Kassenbeleg-V1,   │    │ host app     │
│ as "Bar" (cash)  │    │  BSI TR-03151)     │    │ → W3SPay     │
│ → TSE signs it   │    │ - amount in EUR    │    │              │
└──────────────────┘    │ - kassen-serial    │    └──────┬───────┘
                        │ - TSE signature    │           │
                        └────────────────────┘           ▼
                                                ┌────────────────────┐
                                                │ Lookup merchant in │
                                                │ src/data/merchants │
                                                │ -fallback.json by  │
                                                │ kassen-serial      │
                                                └─────────┬──────────┘
                                                          │
                                                          ▼
                                                ┌────────────────────┐
                                                │ coinPayment.       │
                                                │   paymentRequest   │
                                                │ (undefined, units, │
                                                │  destination)      │
                                                │ → PaymentReceipt   │
                                                └─────────┬──────────┘
                                                          │
                                                          ▼
                                                ┌────────────────────┐
                                                │ Show cashier the   │
                                                │ confirmation page  │
                                                │ (paymentId + tx)   │
                                                └────────────────────┘
```

The merchant runs zero new software. The Coinage leg is settlement on the
side between merchant and customer; the German fiscal system sees a plain
`Bar` (cash) sale and is none the wiser. See `FINDINGS.md` §2.1 for the
legal posture this rides on (and `FINDINGS.md` §6.9 for the open
"is this `Bar` or `Unbar`?" question to ask a German tax advisor before
broader rollout).

## Project layout

```
src/
├── main.tsx                       React entrypoint
├── App.tsx                        thin shell — mounts provider tree + AppShell
├── host-environment.ts            host detection + KvStore (localStorage)
├── styles.css                     UI styles
├── config.ts                      single source of truth for token, thresholds, storage, registry, feature flags
├── app/
│   ├── app-stage.ts               routing-stage union + (auth, balance) → stage mapping
│   ├── payment-flow-context.tsx   provider: host auth + payment host + balance + merchant table + KvStore
│   ├── history-view-context.tsx   provider: activity overlay state ({ closed | list | detail })
│   ├── stage-context.tsx          provider: routing stage + handleDecoded/startScan/performPayment
│   ├── render-stage.tsx           the AppStage switch consumed by AppShell
│   ├── error-messages.ts          host/scanner error → human copy + receiptIdempotencyKey
│   └── dev-hooks.ts               window.__w3spayDev* helpers (gated on isDevStandalone)
├── host/
│   ├── client.ts                  Paseo Asset Hub PAPI client (WS, read-only)
│   ├── host-connection.ts         AccountsProvider singleton + isInHost()
│   ├── payment-host.ts            narrow PaymentHost interface + bridge adapters
│   ├── dev-payment-host.ts        in-memory reference host (vite dev standalone)
│   ├── use-host-auth.ts           hook: subscribeAccountConnectionStatus
│   ├── use-coin-payment-host.ts   hook: resolves the host PaymentHost bridge
│   └── use-terminal-store.ts      hook: lazy-init the W3SPay-scoped KvStore
├── contract/
│   ├── accountid.ts               32-byte AccountId32 hex helpers
│   ├── destination.ts             MerchantDestination union + resolveDestinationBytes()
│   ├── encode-destination.ts      H160 registry destination → AccountId32 (0x00 × 12 ‖ H160)
│   ├── registry-abi.ts            ethers ABI subset for the W3SPay merchant registry contract
│   ├── onchain-loader.ts          ReviveApi.call → ChainOverlay (chain rows decoded)
│   └── load-merchants.ts          chain → cache → empty resolution (no bundled fallback)
├── data/
│   ├── merchant-model.ts          shared MerchantEntry / MerchantTable types
│   ├── send-payment.ts            sendPayment → host.paymentRequest(subtotal+tip cents, dest)
│   ├── tip.ts                     tip math: presets, cent rounding, custom-input parse + sanitize
│   ├── payment-history.ts         KvStore-backed local activity log (schema v2, optional tipCents)
│   └── demo-history.ts            first-run / demo seed for the Activity screen
├── hooks/
│   ├── use-merchant-table.ts      hook: load the merchant table at boot
│   └── use-payment-balance.ts     hook: host.paymentBalance()
├── util/
│   ├── format-amount.ts           cents → "X.YY" display string
│   ├── format.ts                  ASSET_LABEL + splitDisplayName + shortHex
│   ├── error-message.ts           messageFromError / scaleErrReason
│   └── qr-render.ts               render receipt QR back to SVG for the detail view
├── scan/
│   ├── tse-parser.ts              BSI TR-03151 parser → typed record
│   ├── dispatcher.ts              format sniff (V0; | polkadotapp:// | …)
│   ├── camera.ts                  qr-scanner wrapper, typed errors
│   └── …                          camera permission, focus, torch, pinch-zoom helpers
├── screens/
│   ├── ScanningScreen.tsx         full-bleed scanner chrome
│   ├── TipScreen.tsx              tip selection step (editorial, presets + custom)
│   ├── ConfirmScreen.tsx          pre-pay review screen, balance-gated Pay button
│   ├── DoneScreen.tsx             cashier-facing screen with paymentId
│   ├── HistoryScreen.tsx          activity / payment-history list
│   ├── PaymentReceiptScreen.tsx   receipt detail with regenerated QR
│   ├── info.ts                    barrel → per-info-screen file under info/
│   ├── info/                      one .tsx per single-message screen (Boot, HostUnavailable, …)
│   └── scanning/Reticle.tsx       editorial reticle overlay
└── ui/
    ├── primitives.tsx             barrel → per-primitive files under primitives/
    ├── primitives/                Frame, Rail, Eyebrow, Head, Sub, Dotted, Step, MetaRow, Icon, Mark, buttons
    ├── tokens.ts                  typed alias for the CSS-variable palette
    ├── Scanner.tsx                managed qr-scanner lifecycle
    ├── ScreenTransition.tsx       fade-and-translate between routes
    ├── ErrorBoundary.tsx          render-error wall (matches editorial chrome)
    └── Spinner.tsx                editorial spinner

tests/
├── tse-parser.test.ts             parser, dispatcher, parseHexAccountId, formatter
├── merchant-loader.test.ts        bundled normalisation + cache + fallback resolution
├── onchain-loader.test.ts         chain reader + overlay-merge + chain integration
├── destination.test.ts            accountId32 + reviveContract resolution
├── format-amount.test.ts          cents → display string (boundaries + sign)
├── tip.test.ts                    presets, custom-input parse, sanitizer, percent label
└── config.test.ts                 locks token/storage/registry defaults

(The Hardhat workspace for the on-chain merchant registry now lives in
`apps/w3spay-admin/contracts/`. See that app's README for the admin CLI.)

src/contract/onchain-loader.ts     merchant registry reader over
                                   `@/sdk/contracts`' `readContract` — takes the
                                   `PolkadotClient` directly; no PAPI descriptor codegen,
                                   no `@polkadot-api/descriptors`, no `papi generate`.
bundle/manifest.toml               w3spay.dot id, use_extensions=[host.coinpayment]
tools/product-sdk-packs/           vendored SDK tarballs (committed)
deploy.sh                          bulletin-deploy → w3spay.dot
```

## Develop

```sh
npm install --legacy-peer-deps
npm run dev                  # vite on http://localhost:5174 (pinned)
```

`--legacy-peer-deps` is required because npm v10's strict peer resolver
rejects the pinned (often prerelease) Novasama host-API versions used
across this monorepo against the peer ranges their packages declare. The
t3rminal monorepo uses the same workaround.

## Test

```sh
npm test                     # vitest run
npm run typecheck            # tsc --noEmit
```

The parser is the only thing that can silently corrupt user-visible
amounts, so it has the heaviest coverage. Add a fixture in
`tests/tse-parser.test.ts` for any real receipt you can get your hands on
before the demo — the German TSE wire format is rigid enough that
vendor-specific variants are vanishingly rare, but the only way to be
sure is two real receipts from two different TSE vendors.

## Build

```sh
npm run build                # tsc + vite build → dist/
```

Produces a single SPA in `dist/` (CSS ~3.8 kB, JS ~450 kB across two
chunks). The biggest chunk is the polkadot-api descriptors; the qr
scanner ships its jsQR engine as a separately-loaded WebWorker (~50 kB).

## Deploy as `w3spay.dot`

```sh
export DOTNS_MNEMONIC="your twelve word mnemonic phrase here"
./deploy.sh
# or pass a different target:
./deploy.sh staging-w3spay
```

`deploy.sh` requires `bulletin-deploy ≥ 0.7.12` (`npm i -g bulletin-deploy`).
Defaults: target `w3spay.dot`, gateway `dot.li` (override with
`DOTNS_GATEWAY_BASE`). Never put the mnemonic in a file or argv — pipe it
through env.

## Run locally through the dotli host

Hosts like dotli use a **path-prefix proxy**: navigate to
`http://<host>/localhost:<your-port>` and dotli iframes your dev server
into a sandboxed environment with `window.truapi` wired in. There is no
`*.li` TLD for local work — that's only the production gateway.

Three terminals:

```sh
# 1. dotli (the local host) — owns localhost:5173
git clone --recurse-submodules https://github.com/paritytech/dotli.git ~/dotli
cd ~/dotli && bun install && bun run preview
# Use `bun run preview:debugger` to log every host↔product wire frame.

# 2. W3SPay vite dev server — pinned to 5174 (see scripts.dev)
cd w3spay
npm install --legacy-peer-deps   # one-time
npm run dev

# 3. Open in any browser
open "http://localhost:5173/localhost:5174"
```

The dotli page is on a secure-context origin (`localhost`), so
`navigator.mediaDevices.getUserMedia` works without HTTPS.

### Faking a receipt to scan

No printed receipt? Generate the APL Germany fixture as a QR:

```sh
brew install qrencode
qrencode -o tse.png \
  'V0;955002-00;Kassenbeleg-V1;Beleg^0.00_2.55_0.00_0.00_0.00^Bar:2.55;1;42;2020-04-30T14:30:00.000Z;2020-04-30T14:30:01.000Z;ecdsa-plain-SHA256;unixTime;BASE64SIG;BASE64KEY'
open tse.png
```

The example uses kassenSerial `955002-00`. With the bundled merchant
table removed, the confirm screen will land on **"Merchant not in
pilot"** — TSE codes alone don't carry `(merchantId, terminalId)`, and
the registry doesn't index by kassenSerial. To exercise the full
scan → confirm flow, register a t3rminal terminal on chain and scan
the t3rminal-issued deeplink instead. To exercise the multi-VAT
parser path with a TSE QR, swap the `processData`:

```
Beleg^3.50_2.55_0.00_0.00_0.00^Bar:6.05    # coffee (19%) + pretzel (7%)
```

### What can fail and where to look

| Symptom | Likely cause | Fix |
|---|---|---|
| Boot stuck on "Connecting to the Polkadot host" | dotli not running, wrong URL, or `window.truapi` not injected | Check dotli console; navigate to `…/localhost:5174` not bare `:5174` |
| "Camera needed" loop | host webview blocked `getUserMedia` | Allow camera in the OS, retry; native browser permission dialog must trigger once |
| "Merchant not in pilot" | scanned identity not registered on chain, or TSE scan without a t3rminal deeplink | Register on chain via the admin scripts below |
| Payment rejected | RFC 0006 host rejected the destination encoding | See **§6.1.2 gate** below — adjust `src/contract/encode-destination.ts` |
| Same receipt scans as "Already paid" | local idempotency cache hit | Clear `localStorage` for the host origin, or use a different receipt |

## Adding a pilot merchant

The on-chain `W3SPayMerchantRegistry` contract is the single source of
truth: `(merchantId, terminalId) → (address destination, displayName,
addedAt, updatedAt)`. The loader reads it at boot, caches the merged
table in `KvStore`, and serves the cache on subsequent boots if the
on-chain `version` is unchanged. There is no bundled JSON fallback —
when chain and cache both miss, every scan lands on "Merchant not in
pilot".

Set the contract address via `VITE_W3SPAY_REGISTRY_ADDRESS` (the
loader skips the chain step entirely when this env var is empty).

### 1. Register the destination on chain

Admin work lives in a separate nested Hardhat workspace at
`apps/w3spay-admin/contracts/`. Bootstrap once:

```sh
cd apps/w3spay-admin/contracts
npm install
npx hardhat vars set PRIVATE_KEY      # owner / admin EVM private key
npm run compile
npm test
npm run deploy:testnet                # records address in ignition/deployments/
```

Then add or change merchant rows. Each script reads
`W3SPAY_REGISTRY_ADDRESS` from the env so the deployed address is never
baked into source:

```sh
cd apps/w3spay-admin/contracts
export W3SPAY_REGISTRY_ADDRESS=0x...

# Register a new merchant terminal.
npx hardhat run scripts/w3spay-register-merchant.ts --network paseoAssetHub -- \
  --merchant-id=funkhaus \
  --terminal-id=bar-east-01 \
  --destination=0x1234...5678 \
  --display-name="Bar East (Funkhaus)"

# Update destination / displayName for an existing terminal.
npx hardhat run scripts/w3spay-update-merchant.ts --network paseoAssetHub -- \
  --merchant-id=funkhaus \
  --terminal-id=bar-east-01 \
  --destination=0x... \
  --display-name="Bar East v2"

# Remove an entry entirely.
npx hardhat run scripts/w3spay-remove-merchant.ts --network paseoAssetHub -- \
  --merchant-id=funkhaus \
  --terminal-id=bar-east-01

# Grant admin role to another EVM address (owner-only).
npx hardhat run scripts/w3spay-add-registry-admin.ts --network paseoAssetHub -- \
  --admin=0xabc...

# Dump the current table (read-only).
npx hardhat run scripts/w3spay-list-merchants.ts --network paseoAssetHub
```

Rotating a TSE (new `kassenSerial` for the same `(merchantId,
terminalId)`) is **not** a chain operation — and is no longer wired
into w3spay. Identity flows entirely from the t3rminal-issued
deeplink; the chain row keys off `(merchantId, terminalId)` so a TSE
swap is invisible to the registry.

### 2. Wire the merchant identity to the scan

W3SPay receives `(merchantId, terminalId)` from a t3rminal-issued
deeplink (`dot:w3spay.dot/pay?merchant_id=…&terminal_id=…&…`). On
scan, the loader resolves the identity against the cached / live chain
table; the destination + displayName come from the chain row. There
is no JSON file to edit and no kassenSerial → identity mapping to
maintain — register the terminal on chain and that's it.

For an on-chain row to take effect on a returning device, the loader
needs the on-chain `version` to bump (it does on every register /
update / remove). Otherwise the cached snapshot stays in use.

No build step is needed when only the on-chain row changes — the
loader picks up the new version on the next boot. Re-deploy with
`./deploy.sh` only when the SPA itself changes.

## Coinage payment architecture

W3SPay is a thin SDK consumer. The Polkadot host owns the coinage vault
and runs all on-chain settlement. W3SPay calls the RFC 0017 payment
surfaces through the standard product-sdk Host API (`@/sdk/host`'s
`createPaymentManager`) and never touches a key, a WASM blob, or a
JSON-RPC socket.

```
┌──────────────────────────────────────────────────────────────────┐
│ Polkadot host (e.g. dotli)                                        │
│   • derives one CoinageVaultHandle per host session               │
│   • implements the RFC 0017 payment wires:                        │
│       host_payment_balance_subscribe                              │
│       host_payment_top_up                                         │
│       host_payment_request                                        │
│       host_payment_status_subscribe                               │
│   • runs the on-chain settlement executor on Paseo People         │
└──────────────────────────────────────────────────────────────────┘
                          ↑ standard product-sdk Host API (RFC 0017)
┌──────────────────────────────────────────────────────────────────┐
│ W3SPay (this product)                                             │
│                                                                   │
│   const mgr = createPaymentManager(sandboxTransport);             │
│                                                                   │
│   mgr.subscribeBalance(...)    → spendable plancks → cents (1:1)   │
│   mgr.requestPayment(plancks,  → { id }, then await terminal status│
│                      destinationBytes);                           │
└──────────────────────────────────────────────────────────────────┘
```

The previous prototype carried the entire coinage stack (vault, recover,
onboard, pay, chain-rpc, known-coins, known-vouchers, plus a
`createW3SpayCoinPaymentHost` adapter) inside this product because the
host's payment wires were stubbed. The host now ships the real
implementation and exposes it through the standard Host API, so the
product side collapses to a `PaymentHost` adapter over
`createPaymentManager`. The ported coinage stack lives at
`dotli/packages/ui/src/coinpayment/`.

## First-run funding

A freshly-signed-in dotli user has an empty coinage vault. To fund it:

1. **Connect a dotli account.** Use the topbar in dotli to sign in via
   the Polkadot App.

2. **Find the vault address.** Dotli logs the SS58 address of the
   session's coinage vault to the host console at first paint
   (`[dotli/coinpayment] Coinage vault address (Paseo People): …`).
   A wallet card UI for this is a follow-up — for the pilot, the console
   line is enough.

3. **Send CASH to that address.** From any Polkadot wallet that can sign
   a `pallet-balances::transfer` on Paseo People (Talisman, Subwallet,
   Polkadot.js extension), or the testnet faucet.

4. **Wait one finalized block, then refresh W3SPay.** `paymentBalance`
   reflects the funded balance. If the spendable balance is still below
   the receipt total at confirm time, the confirm screen prompts the
   user to top up in the host wallet.

The vault is session-scoped, deterministic per dotli user: log out and
back in as the same user, you get the same vault and balance. Log in as
a different user, you get a fresh vault.

## Non-goals for v1

Deliberately deferred — listed so they don't surprise anyone reviewing
the codebase:

- **TSE ECDSA signature verification** (BSI TR-03145 cert-chain pinning).
  Parser exposes `signatureBase64` + `publicKeyBase64` for v2.
- **Wallet UI for the coinage account in dotli.** Dotli logs the vault
  SS58 address on session start but does not yet ship a "Coinage account"
  card with a "Top up" button. Pilot users send CASH via Talisman/etc.
  using the logged address.
- **Bulletin supplemental receipt** (the Terminal V2 flow). Customer
  keeps only the on-device confirmation.
- **Statement-store receipt visibility** (RFC 0008). Out of scope for the
  pilot's quiet-Sunday architecture.
- **Refund flow.** A merchant who issued a fiscal `Bar` receipt can't
  reverse the Coinage leg through their Kasse; manual side-channel for
  the pilot.
- **Cross-wallet anti-replay.** Same-wallet rescans hit the local
  idempotency cache (key `paidReceipt:<serial>:<tx#>:<sig#>`); a
  *different* wallet scanning a photographed receipt is not blocked. Out
  of scope at pilot scale.
- **EUR↔CASH conversion.** w3spay is single-asset CASH. Receipt cents from the
  TSE QR (which the German fiscal standard denominates in EUR) are
  treated as CASH cents 1:1. Token metadata + thresholds live in
  `src/config.ts` — tweak there.
- **Admin web UI for the registry.** Admins manage entries through the
  Hardhat CLI scripts under `apps/w3spay-admin/contracts/scripts/`. A small admin
  app under `apps/` is a clean follow-up at >10 entries; CLI is enough for
  the pilot.

## Idempotency

When the customer confirms a payment, W3SPay writes
`paidReceipt:<kassenSerial>:<transactionNumber>:<signatureCounter>` →
`paymentId` to the host's localStorage-backed KvStore. A second scan of
the same printed receipt on the same device flips to the "Already paid"
screen with the original `paymentId` rather than re-charging.

The compound key is what the receipt actually identifies on the merchant
side: a TSE guarantees `(serial, transactionNumber, signatureCounter)` is
globally unique per fiscal event. Clearing browser storage clears the
cache.

## License

Same as the parent t3rminal repo. See `LICENSE` if present.

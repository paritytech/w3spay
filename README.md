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
                                                │ src/merchants.json │
                                                │ by kassen-serial   │
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
├── main.ts                        boot + state machine
├── host-environment.ts            host detection + KvStore (localStorage)
├── merchants.json                 hardcoded { kassenSerial → merchant }
├── styles.css                     UI styles
├── scan/
│   ├── tse-parser.ts              BSI TR-03151 parser → typed record
│   ├── dispatcher.ts              format sniff (V0; | polkadotapp:// | …)
│   └── camera.ts                  html5-qrcode wrapper, typed errors
├── pay/
│   ├── encode-destination.ts      H160 0x… → AccountId32 (0xEE × 12 ‖ H160)
│   ├── send.ts                    coinPayment.paymentRequest call
│   ├── confirm.ts                 pre-pay review screen
│   └── done.ts                    cashier-facing "Paid" screen
└── fx/eur-to-pusd.ts              hardcoded 1.07 EUR→USD; bigint pUSD units

tests/
└── tse-parser.test.ts             23 tests: parser, dispatcher, encoder, FX

bundle/
└── manifest.toml                  w3spay.dot id, use_extensions=[host.coinpayment]

tools/product-sdk-packs/           vendored SDK tarballs (committed)
deploy.sh                          bulletin-deploy → w3spay.dot
```

## Develop

```sh
npm install --legacy-peer-deps
npm run dev                  # vite on http://localhost:5174 (pinned)
```

`--legacy-peer-deps` is required because `@parity/product-sdk-host`
declares `@novasamatech/host-api >=0.6.0` as a peer; the t3rminal monorepo
ships `0.7.8-2` and we pin to the same version, which npm v10's strict
resolver rejects. The t3rminal monorepo uses the same workaround.

## Test

```sh
npm test                     # vitest run — 23 tests
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
chunks). The biggest chunk is the html5-qrcode wasm scanner.

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

`955002-00` is in `src/merchants.json`, so the confirm screen will say
**APL Demo Bakery (Berlin) · €2.55**. Aim the device camera at the
on-screen QR. To exercise the multi-VAT path, swap the `processData`:

```
Beleg^3.50_2.55_0.00_0.00_0.00^Bar:6.05    # coffee (19%) + pretzel (7%)
```

### What can fail and where to look

| Symptom | Likely cause | Fix |
|---|---|---|
| Boot stuck on "Connecting to the Polkadot host" | dotli not running, wrong URL, or `window.truapi` not injected | Check dotli console; navigate to `…/localhost:5174` not bare `:5174` |
| "Camera needed" loop | host webview blocked `getUserMedia` | Allow camera in the OS, retry; native browser permission dialog must trigger once |
| "Merchant not in pilot" | scanned `kassenSerial` not in `src/merchants.json` | Add it (see below) or scan a known fixture |
| Payment rejected | RFC 0006 host rejected the destination encoding | See **§6.1.2 gate** below — adjust `src/pay/encode-destination.ts` |
| Same receipt scans as "Already paid" | local idempotency cache hit | Clear `localStorage` for the host origin, or use a different receipt |

## Adding a pilot merchant

Edit `src/merchants.json`. The key is the TSE's `kassen-seriennummer`
exactly as it appears in the receipt's QR (case-sensitive, including any
hyphens). The value is:

```json
{
  "merchantId": "short-stable-handle",
  "terminalId": "register-or-counter-name",
  "smartContractAddress": "0x<20-byte H160 of the merchant's revive contract>",
  "displayName": "Human-readable name on the confirm screen",
  "addedAt": "ISO-8601 timestamp"
}
```

No build step is needed — vite picks the JSON change up on save. For
production you re-deploy with `./deploy.sh`. The schema moves to an
admin-configurable backend post-pilot; today the JSON file is the v1
mechanism.

## §6.1.2 gate — destination byte format

The plan's one open question (`local://w3spay-prototype.md` §6.1.2):
when RFC 0006's `paymentRequest(destination: Uint8Array)` resolves a
`pallet-revive` contract address, what bytes does the host expect?

`src/pay/encode-destination.ts` locks in the **`0xEE × 12 ‖ H160`**
canonical mapping — pallet-revive's default `AccountId32Mapper` for any
unmapped H160, which is always the case for contract accounts. This is
the documented best-guess and is what the parser tests assert against
the bulletinIndex address from `t3rminal/lib/contracts/config.ts`.

**On demo day, validate this before merchants arrive.** The round-trip
spike is ~30 minutes:

1. Run W3SPay against a sandbox dotli with `preview:debugger`.
2. Send a tiny test payment (€0.01 → a known revive contract).
3. Watch the debug panel for the destination bytes the host actually
   ships to chain.
4. If they don't match `0xEE × 12 ‖ H160`, swap the encoder in
   `src/pay/encode-destination.ts`. Everything else is structured to
   not care.

A fallback path exists: each merchant entry in `merchants.json` can
optionally carry a `ss58Fallback: "5…"` field for an EOA the merchant
owns, and the encoder can decode SS58 instead. Not wired in v1; add the
branch in `encodeReviveContractDestination` if the spike forces it.

## Non-goals for v1

Deliberately deferred — listed so they don't surprise anyone reviewing
the codebase:

- **TSE ECDSA signature verification** (BSI TR-03145 cert-chain pinning).
  Parser exposes `signatureBase64` + `publicKeyBase64` for v2.
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
- **Real eurobot FX integration.** Hardcoded 1.07 in
  `src/fx/eur-to-pusd.ts`. The signature is structured so the eurobot
  drop-in is a one-function swap.
- **Admin-configurable merchant backend.** Hand-curated JSON for the
  pilot; same shape moves to a backend later.

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

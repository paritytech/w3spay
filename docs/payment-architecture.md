# W3SPay payment architecture

How money flows from the customer's wallet to the merchant's contract,
and what the host↔w3spay payment boundary owns.

## The four accounts

| # | Account                                | Lives in                | Holds                       | Who signs |
|---|----------------------------------------|-------------------------|-----------------------------|-----------|
| 1 | User's main wallet                     | Talisman / Subwallet    | CASH on Paseo People        | The user, via their wallet |
| 2 | Dotli coinage vault (`vault.publicAccountId`) | `@useragent-kit/coinage-wasm` (inside dotli) | CASH on Paseo People        | The vault, via WASM (no UI) |
| 3 | Dotli coinage vault, voucher form      | `@useragent-kit/coinage-wasm` (inside dotli) | Coinage **vouchers**        | The vault, via WASM |
| 4 | Merchant destination                   | `W3SPayMerchantRegistry` (on-chain) | CASH on Paseo People        | (Receives only) |

The funding flow is `1 → 2 → 3`, then payment is `3 → 4`:

1. **Wallet → vault.** External wallet transfer (`Assets.transfer`).
   User-mediated; dotli logs the vault's SS58 address on session start
   so a user can copy it into Talisman or paste it into a faucet.
2. **Vault CASH → vault vouchers.** `host.paymentTopUp({ kind: "productAccount", derivationIndex: 0 }, amount)` — synthetic onboarding inside `coinage-wasm`, run by dotli. Implemented; not invoked by w3spay in v1.
3. **Vault coins → merchant.** `host.paymentRequest(cents, merchantBytes)`
   — adapter delegates to host coin selection → plan → sign → submit each
   per-coin extrinsic.

The vault key never leaves the WASM module inside dotli. It is derived
deterministically from the dotli session secret
(`blake2b256("dotli-coinage-vault-v1" || ssSecret) → 32-byte entropy →
CoinageVaultHandle.fromEntropy`), so every login of the same dotli user
lands on the same vault account on chain.

The product boundary is the same for native Polkadot hosts: the host owns
mnemonics, root entropy, voucher indices, Bandersnatch/Ring-VRF keys, and
all signing material. w3spay only asks for balance and payment operations
and renders the resulting status.

## Why the host side owns the vault

Earlier prototypes of w3spay carried the entire coinage stack
(`vault.ts`, `recover.ts`, `onboard.ts`, `pay.ts`, `chain-rpc.ts`,
`known-coins.ts`, `known-vouchers.ts`, `wasm.ts`, and a
`createW3SpayCoinPaymentHost` adapter) inside the product iframe,
because dotli's `host_payment_*` wires were stubbed with
`PAYMENTS_NOT_IMPLEMENTED`. The product self-provided the missing host
behaviour.

dotli implements the four RFC 0017 payment wires
(`host_payment_balance_subscribe`, `host_payment_top_up`,
`host_payment_request`, `host_payment_status_subscribe`) in
`dotli/packages/ui/src/coinpayment/`. Native Polkadot hosts expose the
same payer capability through the standard product-sdk Host API
(`createPaymentManager`). In both cases the vault, key derivation, voucher
tracking, RPC, and on-chain executor live in the host where they belong.

W3SPay consumes a narrow internal `PaymentHost` interface, then adapts the
available host at boot:

1. `vite dev` standalone uses an in-memory reference host.
2. Inside a Polkadot host, w3spay speaks the standard product-sdk Host API
   via `createPaymentManager(sandboxTransport)` from
   `@novasamatech/host-api-wrapper` (re-exported by `@/sdk/host`).

```ts
const { available } = await host.paymentBalance();
const receipt = await host.paymentRequest(cents, destinationBytes);
```

## SDK alignment

The customer-facing call sites speak the **w3spay `PaymentHost` shape**;
the standard Host API adapter maps it onto the host payment manager:

| `PaymentHost` method | standard Host API bridge |
|----------------------|--------------------------|
| `paymentBalance()` | one-shot read from `createPaymentManager(sandboxTransport).subscribeBalance(...)` |
| `paymentRequest(amountCents, destination)` | `createPaymentManager(sandboxTransport).requestPayment(BigInt(amountCents) * plancksPerCent, destination)`, then await terminal payment status |

The adapter converts host `bigint` balances to numbers only when they fit
in JavaScript's safe integer range; larger balances fail explicitly
instead of silently rounding.

The native Host API returns from `requestPayment` before the on-chain
extrinsic settles — a background worker drives `processing → completed`
(or `failed`) on the status subscription. `paymentRequest` awaits that
subscription so the returned receipt is post-finalization; an interrupted
subscription surfaces as `settlement: "unconfirmed"` rather than a false
failure.

## What lives where

```
w3spay/src/
  config.ts                     token metadata, payment thresholds, host wait policy, storage envelope
  App.tsx                       thin SDK consumer; stages: connecting → checking-balance
                                → scanning → tip → confirm → paying → done
  host/payment-host.ts          `PaymentHost` interface + standard Host
                                API adapter (in-memory dev host lives in
                                host/dev-payment-host.ts)
  data/send-payment.ts          host.paymentRequest(subtotalCents + tipCents, dest)
  data/tip.ts                   tip math: presets, cent rounding, custom-input parse + sanitize
  screens/TipScreen.tsx         editorial tip step between scan and confirm
  hooks/use-payment-balance.ts  host.paymentBalance() with a refresh() handle
  contract/destination.ts       MerchantDestination → 32-byte bytes
  data/merchant-model.ts        shared MerchantEntry / MerchantTable types
  contract/registry-abi.ts      viem-compatible ABI subset for the on-chain registry
  contract/onchain-loader.ts    @/sdk/contracts readContract dry-run → ChainOverlay
  contract/load-merchants.ts    chain → cache → empty (no bundled fallback)
  host/client.ts                Paseo Asset Hub PAPI client (WS, read-only)
  host/use-host-auth.ts         subscribeAccountConnectionStatus
  host/host-connection.ts       AccountsProvider singleton + isInHost()

w3spay-admin/contracts/          nested Hardhat workspace (admin CLI)
  src/W3SPayMerchantRegistry.sol admin-managed (merchantId, terminalId) → destination
  scripts/                       register / update / remove / add-admin / list

dotli/packages/ui/src/coinpayment/
  index.ts                      exports registerCoinPaymentHandlers
  handlers.ts                   four container.handle* registrations + vault singleton
  vault.ts                      blake2b256(label || ssSecret) → CoinageVaultHandle
  storage.ts                    KvStore over localStorage (prefix dotli:coinage:)
  network.ts                    Paseo People (Next) RPC + asset config (from WASM)
  chain-rpc.ts                  JSON-RPC: runtime snapshot, nonce, submitAndWatch
  known-coins.ts                KvStore persistence for known coin indices
  known-vouchers.ts             KvStore persistence for known voucher records
  recover.ts                    wasm.queryVouchers / queryLegacyWalletCoins
  onboard.ts                    wasm.onboardPublicFunds (CASH → voucher form)
  pay.ts                        manual per-coin executor (encode → sign → submit)
  wasm.ts                       lazy loader for @useragent-kit/coinage-wasm

polkadot-app-android-v2/          native host with balance/request/top-up/status
                                  payment Host API support

polkadot-app-ios-v2/              native coinage implementation exists, but payer
                                  `paymentRequest`/status are not exposed to
                                  products yet
```

## Funding (manual, MVP)

There is no in-product funding screen. To put money into the dotli
coinage vault:

1. Sign in to dotli. The host console prints the vault SS58 address:
   `[dotli/coinpayment] Coinage vault address (Paseo People): 5…`.
2. Send CASH to that address from any Polkadot wallet that can sign a
   `pallet-balances::transfer` on Paseo People (Talisman, Subwallet,
   Polkadot.js extension), or the testnet faucet.
3. Wait one finalized block, then refresh the product. The next
   `paymentBalance` call sees the funded balance and the confirm screen
   stops showing the insufficient-balance hint.

A wallet UI inside dotli — "Coinage account" card with address + balance
+ a "Top up" button that calls `paymentTopUp` — is a follow-up. For the
pilot, the console line + an external wallet is enough.

## Failure-mode contract

The product side surfaces these specific cases:

- `auth.kind === "outsideHost"` — running standalone, dotli not present.
  → "Host unavailable" screen.
- `auth.kind === "disconnected"` — host present but the user isn't
  signed in. → "Sign in to Polkadot" screen.
- `balance.kind === "error"` — `host.paymentBalance()` threw. →
  "Host unavailable" with the underlying message. Usually means dotli
  cannot reach the Paseo People RPC.
- `PaymentRequestErr::InsufficientBalance` from `paymentRequest` — the
  host vault has less than the receipt total. → "Payment failed" with the
  "not enough balance" copy and a hint to top up in the host wallet.
- `PaymentRequestErr::Rejected` from `paymentRequest` — the host
  explicitly refused the payment. → "Payment failed", generic retry copy.
- A terminal `failed` payment status, or any other throw — → "Payment
  failed", generic retry copy. The structured code is never leaked to the
  customer-facing copy.
- Standard Host API balance larger than `Number.MAX_SAFE_INTEGER` — the
  adapter rejects it before the UI can display a rounded cent value.

iOS native payer support must not be claimed until the native iOS product
bridge registers and implements `paymentRequest` and payment status
subscription methods.

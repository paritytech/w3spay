import {
  createCoinPaymentClient,
  type CoinPaymentHostApi,
  type CoinPaymentWindow,
  type CreateCoinPaymentClientOptions,
} from "@parity/product-sdk-coin-payment";
import {
  createTerminalStore,
  detectRuntimeEnvironment,
  type KvStore,
  type RuntimeEnvironment,
} from "./host-environment.ts";
import {
  startQrScanner,
  ScannerError,
  type ScannerHandle,
} from "./scan/camera.ts";
import { dispatchScannedPayload, type ScanResult, type UnsupportedReason } from "./scan/dispatcher.ts";
import type { ParsedTseQr } from "./scan/tse-parser.ts";
import { eurCentsToPusdUnits, formatEurCents, formatPusdSmallestUnit } from "./fx/eur-to-pusd.ts";
import { bindConfirmEvents, renderConfirm } from "./pay/confirm.ts";
import { bindDoneEvents, renderDone } from "./pay/done.ts";
import { sendPayment, type SendPaymentResult } from "./pay/send.ts";
import merchantsTable from "./merchants.json";
import "./styles.css";

interface MerchantEntry {
  merchantId: string;
  terminalId: string;
  smartContractAddress: string;
  displayName: string;
  addedAt: string;
}

type CoinageWindow = Window & CoinPaymentWindow;

type AppStage =
  | { kind: "boot" }
  | { kind: "needsCamera"; message: string }
  | { kind: "scanning" }
  | { kind: "confirm"; parsed: ParsedTseQr; merchant: MerchantEntry; pusdAmountUnits: bigint }
  | { kind: "paying"; parsed: ParsedTseQr; merchant: MerchantEntry; pusdAmountUnits: bigint }
  | { kind: "done"; parsed: ParsedTseQr; merchant: MerchantEntry; payment: SendPaymentResult }
  | { kind: "alreadyPaid"; parsed: ParsedTseQr; merchant: MerchantEntry; existingPaymentId: string }
  | { kind: "unsupportedScan"; reason: UnsupportedReason; raw: string }
  | { kind: "scanError"; message: string }
  | { kind: "unknownMerchant"; parsed: ParsedTseQr }
  | { kind: "hostUnavailable"; message: string }
  | { kind: "payError"; message: string; parsed: ParsedTseQr; merchant: MerchantEntry };

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("missing #app root");
const app = appRoot;

const merchants = merchantsTable as Record<string, MerchantEntry>;

const state: {
  stage: AppStage;
  runtimeEnvironment: RuntimeEnvironment | "pending";
  coinPayment: CoinPaymentHostApi | undefined;
  store: KvStore | null;
  scannerHandle: ScannerHandle | null;
} = {
  stage: { kind: "boot" },
  runtimeEnvironment: "pending",
  coinPayment: undefined,
  store: null,
  scannerHandle: null,
};

boot();

async function boot(): Promise<void> {
  render();
  try {
    const [runtimeEnvironment, store] = await Promise.all([
      detectRuntimeEnvironment(),
      createTerminalStore("w3spay"),
    ]);
    state.runtimeEnvironment = runtimeEnvironment;
    state.store = store;
    const coinPayment = await waitForCoinPaymentHost(window as CoinageWindow, runtimeEnvironment);
    if (!coinPayment) {
      transitionTo({
        kind: "hostUnavailable",
        message:
          "Coinage payment isn't available in this host. Open W3SPay from the Polkadot app to scan and pay.",
      });
      return;
    }
    state.coinPayment = coinPayment;
    await startScanning();
  } catch (caught) {
    transitionTo({
      kind: "hostUnavailable",
      message: messageOf(caught, "Failed to initialise W3SPay."),
    });
  }
}

function resolveCoinPaymentHost(agentWindow: CoinageWindow): CoinPaymentHostApi | undefined {
  try {
    return createCoinPaymentClient({
      truapi: agentWindow.truapi,
      windowLike: agentWindow,
    } satisfies CreateCoinPaymentClientOptions);
  } catch {
    return undefined;
  }
}

async function waitForCoinPaymentHost(
  agentWindow: CoinageWindow,
  runtimeEnvironment: RuntimeEnvironment,
): Promise<CoinPaymentHostApi | undefined> {
  const timeoutMs = runtimeEnvironment === "host" ? 3_000 : 250;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const host = resolveCoinPaymentHost(agentWindow);
    if (host) return host;
    await delay(50);
  }
  return resolveCoinPaymentHost(agentWindow);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function startScanning(): Promise<void> {
  await stopScanner();
  transitionTo({ kind: "scanning" });
  const host = app.querySelector<HTMLDivElement>("#w3spay-qr-reader");
  if (!host) {
    transitionTo({ kind: "scanError", message: "Scanner view did not mount." });
    return;
  }
  try {
    state.scannerHandle = await startQrScanner(host, {
      onDecoded: handleDecoded,
      onError: (error) => {
        if (error.code === "permissionDenied") {
          transitionTo({
            kind: "needsCamera",
            message:
              "W3SPay needs camera access to scan the receipt QR. Allow camera access for the Polkadot app and try again.",
          });
        }
      },
    });
  } catch (caught) {
    if (caught instanceof ScannerError) {
      if (caught.code === "permissionDenied") {
        transitionTo({
          kind: "needsCamera",
          message:
            "W3SPay needs camera access. Allow camera access for the Polkadot app and tap retry.",
        });
        return;
      }
      transitionTo({ kind: "scanError", message: caught.message });
      return;
    }
    transitionTo({ kind: "scanError", message: messageOf(caught, "Could not start the camera.") });
  }
}

async function stopScanner(): Promise<void> {
  const handle = state.scannerHandle;
  state.scannerHandle = null;
  if (handle) {
    try {
      await handle.stop();
    } catch {
      // ignore — html5-qrcode raises when stopping in odd lifecycle states.
    }
  }
}

function handleDecoded(rawText: string): void {
  // The decoded callback fires while the scanner still owns the camera.
  // Stop it eagerly: every transition below leaves the scanning stage,
  // and `render()` will tear down the host `<div>` underneath the video
  // element without releasing the MediaStream.
  void stopScanner();
  const result: ScanResult = dispatchScannedPayload(rawText.trim());
  if (result.kind === "unsupported") {
    transitionTo({ kind: "unsupportedScan", reason: result.reason, raw: result.raw });
    return;
  }
  if (result.kind === "invalid") {
    transitionTo({ kind: "scanError", message: `Could not parse receipt QR: ${result.error.message}` });
    return;
  }
  const parsed = result.payload;
  const merchant = merchants[parsed.kassenSerial];
  if (!merchant) {
    transitionTo({ kind: "unknownMerchant", parsed });
    return;
  }
  const idempotencyKey = receiptIdempotencyKey(parsed);
  const existing = state.store?.get(idempotencyKey);
  Promise.resolve(existing).then((maybePaymentId) => {
    if (maybePaymentId) {
      transitionTo({
        kind: "alreadyPaid",
        parsed,
        merchant,
        existingPaymentId: maybePaymentId,
      });
      return;
    }
    const pusdAmountUnits = eurCentsToPusdUnits(parsed.amountEurCents);
    transitionTo({ kind: "confirm", parsed, merchant, pusdAmountUnits });
  });
}

function receiptIdempotencyKey(parsed: ParsedTseQr): string {
  return `paidReceipt:${parsed.kassenSerial}:${parsed.transactionNumber}:${parsed.signatureCounter}`;
}

async function performPayment(parsed: ParsedTseQr, merchant: MerchantEntry, pusdAmountUnits: bigint): Promise<void> {
  const coinPayment = state.coinPayment;
  if (!coinPayment) {
    transitionTo({
      kind: "hostUnavailable",
      message: "Coinage payment is no longer available. Reopen W3SPay from the Polkadot app.",
    });
    return;
  }
  transitionTo({ kind: "paying", parsed, merchant, pusdAmountUnits });
  try {
    const payment = await sendPayment({
      coinPayment,
      amountUnits: pusdAmountUnits,
      smartContractAddress: merchant.smartContractAddress,
    });
    if (state.store) {
      await state.store.set(receiptIdempotencyKey(parsed), payment.paymentId);
    }
    transitionTo({ kind: "done", parsed, merchant, payment });
  } catch (caught) {
    transitionTo({
      kind: "payError",
      message: messageOf(caught, "Payment failed."),
      parsed,
      merchant,
    });
  }
}

function transitionTo(stage: AppStage): void {
  state.stage = stage;
  render();
}

function render(): void {
  app.innerHTML = renderShell(renderStage());
  bindStageEvents();
}

function renderShell(body: string): string {
  return `
    <section class="workspace">
      <header class="brand-strip">
        <p class="eyebrow">Outside-venue Coinage scanner</p>
        <h1>W3SPay</h1>
      </header>
      ${body}
    </section>
  `;
}

function renderStage(): string {
  switch (state.stage.kind) {
    case "boot":
      return renderInfo({
        title: "Starting…",
        body: "Connecting to the Polkadot host.",
      });
    case "needsCamera":
      return renderInfo({
        title: "Camera needed",
        body: state.stage.message,
        action: { label: "Retry", id: "retry-scan" },
      });
    case "scanning":
      return `
        <section class="screen scan-screen">
          <header class="screen-head">
            <p class="screen-eyebrow">Step 1 of 2</p>
            <h2 class="screen-title">Scan the receipt</h2>
            <p class="screen-subtitle">Point the camera at the QR on the printed receipt.</p>
          </header>
          <div id="w3spay-qr-reader" class="qr-reader" aria-label="QR scanner"></div>
          <p class="cashier-hint">Only German fiscal TSE receipts are supported in this pilot.</p>
        </section>
      `;
    case "confirm":
      return renderConfirm({
        merchantDisplayName: state.stage.merchant.displayName,
        terminalId: state.stage.merchant.terminalId,
        parsed: state.stage.parsed,
        pusdAmountUnits: state.stage.pusdAmountUnits,
        smartContractAddress: state.stage.merchant.smartContractAddress,
      });
    case "paying":
      return renderInfo({
        title: "Paying…",
        body: `Sending €${formatEurCents(state.stage.parsed.amountEurCents)} (≈ ${formatPusdSmallestUnit(state.stage.pusdAmountUnits)} pUSD) to ${state.stage.merchant.displayName}.`,
      });
    case "done":
      return renderDone({
        merchantDisplayName: state.stage.merchant.displayName,
        terminalId: state.stage.merchant.terminalId,
        parsed: state.stage.parsed,
        paymentId: state.stage.payment.paymentId,
        primaryTransactionHashHex: state.stage.payment.primaryTransactionHashHex,
      });
    case "alreadyPaid":
      return renderInfo({
        title: "Already paid",
        body: `Receipt ${state.stage.parsed.kassenSerial}/${state.stage.parsed.transactionNumber} has already been paid on this device. Payment id ${state.stage.existingPaymentId}.`,
        action: { label: "New scan", id: "retry-scan" },
      });
    case "unsupportedScan":
      return renderInfo({
        title: "Unsupported QR",
        body: describeUnsupported(state.stage.reason),
        action: { label: "Retry", id: "retry-scan" },
      });
    case "scanError":
      return renderInfo({
        title: "Scan failed",
        body: state.stage.message,
        action: { label: "Retry", id: "retry-scan" },
      });
    case "unknownMerchant":
      return renderInfo({
        title: "Merchant not in pilot",
        body: `TSE serial ${state.stage.parsed.kassenSerial} isn't registered for the Web3 Summit pilot. Pay with another method.`,
        action: { label: "New scan", id: "retry-scan" },
      });
    case "hostUnavailable":
      return renderInfo({
        title: "Host unavailable",
        body: state.stage.message,
      });
    case "payError":
      return renderInfo({
        title: "Payment failed",
        body: state.stage.message,
        action: { label: "Try again", id: "retry-payment" },
      });
  }
}

interface InfoCard {
  title: string;
  body: string;
  action?: { label: string; id: "retry-scan" | "retry-payment" };
}

function renderInfo(card: InfoCard): string {
  const action = card.action
    ? `<div class="actions"><button class="primary" data-action="${card.action.id}" type="button">${escapeHtml(card.action.label)}</button></div>`
    : "";
  return `
    <section class="screen info-screen">
      <header class="screen-head">
        <h2 class="screen-title">${escapeHtml(card.title)}</h2>
      </header>
      <p class="screen-body">${escapeHtml(card.body)}</p>
      ${action}
    </section>
  `;
}

function describeUnsupported(reason: UnsupportedReason): string {
  switch (reason) {
    case "legacyPolkadotappDeeplink":
      return "This is a wallet deeplink, not a German fiscal TSE QR. Scan the receipt printed by the merchant's till.";
    case "polkadotUriScheme":
      return "This is a plain Polkadot address, not a fiscal receipt QR. Scan the receipt printed by the merchant's till.";
    case "embeddedQrJson":
      return "This looks like an in-venue claim QR. Scan the printed receipt QR instead.";
    case "empty":
      return "Empty QR payload. Try again.";
    case "unknownFormat":
      return "Unrecognised QR format. Only German fiscal TSE receipts are supported.";
  }
}

function bindStageEvents(): void {
  const stage = state.stage;
  if (stage.kind === "confirm") {
    bindConfirmEvents(app, {
      onConfirm: () => {
        void performPayment(stage.parsed, stage.merchant, stage.pusdAmountUnits);
      },
      onCancel: () => {
        void startScanning();
      },
    });
    return;
  }
  if (stage.kind === "done") {
    bindDoneEvents(app, { onAcknowledge: () => void startScanning() });
    return;
  }
  app
    .querySelector<HTMLButtonElement>("[data-action=retry-scan]")
    ?.addEventListener("click", () => void startScanning(), { once: true });
  app
    .querySelector<HTMLButtonElement>("[data-action=retry-payment]")
    ?.addEventListener("click", () => {
      if (stage.kind !== "payError") return;
      void performPayment(stage.parsed, stage.merchant, eurCentsToPusdUnits(stage.parsed.amountEurCents));
    }, { once: true });
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

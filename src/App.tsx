import { useCallback, useEffect, useRef, useState } from "react";
import { isInsideContainer } from "@parity/product-sdk-host";
import { requestDevicePermission } from "@novasamatech/product-sdk";

import {
  createTerminalStore,
  type KvStore,
} from "./host-environment.ts";
import { Scanner } from "./ui/Scanner.tsx";
import { InfoScreen } from "./ui/InfoScreen.tsx";
import { ConfirmScreen } from "./pay/ConfirmScreen.tsx";
import { DoneScreen } from "./pay/DoneScreen.tsx";
import { sendPayment, type SendPaymentResult } from "./pay/send.ts";
import {
  eurCentsToPusdUnits,
  formatEurCents,
  formatPusdSmallestUnit,
} from "./fx/eur-to-pusd.ts";
import {
  dispatchScannedPayload,
  type ScanResult,
  type UnsupportedReason,
} from "./scan/dispatcher.ts";
import type { ParsedTseQr } from "./scan/tse-parser.ts";
import {
  usePaymentBalance,
  isKnownInsufficient,
  type PaymentBalanceState,
} from "./host/use-payment-balance.ts";
import merchantsTable from "./merchants.json";

interface MerchantEntry {
  merchantId: string;
  terminalId: string;
  smartContractAddress: string;
  displayName: string;
  addedAt: string;
}

type AppStage =
  | { kind: "boot" }
  | { kind: "needsCamera"; message: string }
  | { kind: "scanning" }
  | {
      kind: "confirm";
      parsed: ParsedTseQr;
      merchant: MerchantEntry;
      pusdAmountUnits: bigint;
    }
  | {
      kind: "paying";
      parsed: ParsedTseQr;
      merchant: MerchantEntry;
      pusdAmountUnits: bigint;
    }
  | {
      kind: "done";
      parsed: ParsedTseQr;
      merchant: MerchantEntry;
      payment: SendPaymentResult;
    }
  | {
      kind: "alreadyPaid";
      parsed: ParsedTseQr;
      merchant: MerchantEntry;
      existingPaymentId: string;
    }
  | { kind: "unsupportedScan"; reason: UnsupportedReason; raw: string }
  | { kind: "scanError"; message: string }
  | { kind: "unknownMerchant"; parsed: ParsedTseQr }
  | { kind: "hostUnavailable"; message: string }
  | {
      kind: "payError";
      message: string;
      parsed: ParsedTseQr;
      merchant: MerchantEntry;
    };

const merchants = merchantsTable as Record<string, MerchantEntry>;

export function App() {
  const [stage, setStage] = useState<AppStage>({ kind: "boot" });
  const storeRef = useRef<KvStore | null>(null);
  const balance = usePaymentBalance();

  // Boot effect: detect host, request camera permission, advance to
  // scanning. Runs once. The Scanner component itself owns the camera
  // MediaStream lifecycle.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [insideContainer, store] = await Promise.all([
          isInsideContainer(),
          createTerminalStore("w3spay"),
        ]);
        if (cancelled) return;
        storeRef.current = store;

        if (!insideContainer) {
          setStage({
            kind: "hostUnavailable",
            message:
              "W3SPay must run inside the Polkadot host. Open this URL via the Polkadot app, or proxy it through your local dotli host (http://localhost:5173/localhost:5174).",
          });
          return;
        }

        // Best-effort RFC 0002 camera prompt. Older hosts may not implement
        // it; we fall through to the browser's native getUserMedia gesture.
        try {
          await requestDevicePermission("Camera");
        } catch {
          // ignore
        }

        if (!cancelled) setStage({ kind: "scanning" });
      } catch (caught) {
        if (cancelled) return;
        setStage({
          kind: "hostUnavailable",
          message: messageOf(caught, "Failed to initialise W3SPay."),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDecoded = useCallback((rawText: string) => {
    const result: ScanResult = dispatchScannedPayload(rawText.trim());
    if (result.kind === "unsupported") {
      setStage({ kind: "unsupportedScan", reason: result.reason, raw: result.raw });
      return;
    }
    if (result.kind === "invalid") {
      setStage({
        kind: "scanError",
        message: `Could not parse receipt QR: ${result.error.message}`,
      });
      return;
    }
    const parsed = result.payload;
    const merchant = merchants[parsed.kassenSerial];
    if (!merchant) {
      setStage({ kind: "unknownMerchant", parsed });
      return;
    }
    const idempotencyKey = receiptIdempotencyKey(parsed);
    void (async () => {
      const existing = await storeRef.current?.get(idempotencyKey);
      if (existing) {
        setStage({
          kind: "alreadyPaid",
          parsed,
          merchant,
          existingPaymentId: existing,
        });
        return;
      }
      const pusdAmountUnits = eurCentsToPusdUnits(parsed.amountEurCents);
      setStage({ kind: "confirm", parsed, merchant, pusdAmountUnits });
    })();
  }, []);

  const startScan = useCallback(() => {
    setStage({ kind: "scanning" });
  }, []);

  const performPayment = useCallback(
    async (parsed: ParsedTseQr, merchant: MerchantEntry, pusdAmountUnits: bigint) => {
      if (!(await isInsideContainer())) {
        setStage({
          kind: "hostUnavailable",
          message: "Lost connection to the Polkadot host. Reopen W3SPay from the host.",
        });
        return;
      }
      setStage({ kind: "paying", parsed, merchant, pusdAmountUnits });
      try {
        const payment = await sendPayment({
          amountUnits: pusdAmountUnits,
          smartContractAddress: merchant.smartContractAddress,
        });
        await storeRef.current?.set(receiptIdempotencyKey(parsed), payment.paymentId);
        setStage({ kind: "done", parsed, merchant, payment });
      } catch (caught) {
        setStage({
          kind: "payError",
          message: messageOf(caught, "Payment failed."),
          parsed,
          merchant,
        });
      }
    },
    [],
  );

  return (
    <section className="workspace">
      <header className="brand-strip">
        <p className="eyebrow">Outside-venue Coinage scanner</p>
        <h1>W3SPay</h1>
      </header>
      <Stage
        stage={stage}
        balance={balance}
        onDecoded={handleDecoded}
        onPermissionDenied={() =>
          setStage({
            kind: "needsCamera",
            message:
              "W3SPay needs camera access to scan the receipt QR. Allow camera access for the Polkadot app and try again.",
          })
        }
        onScannerStartError={(message) => setStage({ kind: "scanError", message })}
        onConfirm={(s) => void performPayment(s.parsed, s.merchant, s.pusdAmountUnits)}
        onCancelConfirm={startScan}
        onRetryScan={startScan}
        onRetryPayment={(s) =>
          void performPayment(s.parsed, s.merchant, eurCentsToPusdUnits(s.parsed.amountEurCents))
        }
      />
    </section>
  );
}

interface StageProps {
  stage: AppStage;
  balance: PaymentBalanceState;
  onDecoded: (text: string) => void;
  onPermissionDenied: () => void;
  onScannerStartError: (message: string) => void;
  onConfirm: (s: Extract<AppStage, { kind: "confirm" }>) => void;
  onCancelConfirm: () => void;
  onRetryScan: () => void;
  onRetryPayment: (s: Extract<AppStage, { kind: "payError" }>) => void;
}

function Stage(props: StageProps) {
  const { stage } = props;
  switch (stage.kind) {
    case "boot":
      return (
        <InfoScreen title="Starting…">
          Connecting to the Polkadot host.
        </InfoScreen>
      );
    case "needsCamera":
      return (
        <InfoScreen title="Camera needed" actionLabel="Retry" onAction={props.onRetryScan}>
          {stage.message}
        </InfoScreen>
      );
    case "scanning":
      return (
        <section className="screen scan-screen">
          <header className="screen-head">
            <p className="screen-eyebrow">Step 1 of 2</p>
            <h2 className="screen-title">Scan the receipt</h2>
            <p className="screen-subtitle">
              Point the camera at the QR on the printed receipt.
            </p>
          </header>
          <Scanner
            onDecoded={props.onDecoded}
            onPermissionDenied={props.onPermissionDenied}
            onStartError={(err) =>
              err.code === "permissionDenied"
                ? props.onPermissionDenied()
                : props.onScannerStartError(err.message)
            }
          />
          <BalancePreview balance={props.balance} />
          <p className="cashier-hint">
            Only German fiscal TSE receipts are supported in this pilot.
          </p>
        </section>
      );
    case "confirm":
      return (
        <ConfirmScreen
          merchantDisplayName={stage.merchant.displayName}
          terminalId={stage.merchant.terminalId}
          parsed={stage.parsed}
          pusdAmountUnits={stage.pusdAmountUnits}
          smartContractAddress={stage.merchant.smartContractAddress}
          balance={props.balance}
          insufficient={isKnownInsufficient(props.balance, stage.pusdAmountUnits)}
          onConfirm={() => props.onConfirm(stage)}
          onCancel={props.onCancelConfirm}
        />
      );
    case "paying":
      return (
        <InfoScreen title="Paying…">
          Sending €{formatEurCents(stage.parsed.amountEurCents)} (≈{" "}
          {formatPusdSmallestUnit(stage.pusdAmountUnits)} pUSD) to{" "}
          {stage.merchant.displayName}.
        </InfoScreen>
      );
    case "done":
      return (
        <DoneScreen
          merchantDisplayName={stage.merchant.displayName}
          terminalId={stage.merchant.terminalId}
          parsed={stage.parsed}
          paymentId={stage.payment.paymentId}
          onAcknowledge={props.onRetryScan}
        />
      );
    case "alreadyPaid":
      return (
        <InfoScreen
          title="Already paid"
          actionLabel="New scan"
          onAction={props.onRetryScan}
        >
          Receipt {stage.parsed.kassenSerial}/{stage.parsed.transactionNumber} has
          already been paid on this device. Payment id {stage.existingPaymentId}.
        </InfoScreen>
      );
    case "unsupportedScan":
      return (
        <InfoScreen title="Unsupported QR" actionLabel="Retry" onAction={props.onRetryScan}>
          {describeUnsupported(stage.reason)}
        </InfoScreen>
      );
    case "scanError":
      return (
        <InfoScreen title="Scan failed" actionLabel="Retry" onAction={props.onRetryScan}>
          {stage.message}
        </InfoScreen>
      );
    case "unknownMerchant":
      return (
        <InfoScreen
          title="Merchant not in pilot"
          actionLabel="New scan"
          onAction={props.onRetryScan}
        >
          TSE serial {stage.parsed.kassenSerial} isn't registered for the Web3 Summit
          pilot. Pay with another method.
        </InfoScreen>
      );
    case "hostUnavailable":
      return <InfoScreen title="Host unavailable">{stage.message}</InfoScreen>;
    case "payError":
      return (
        <InfoScreen
          title="Payment failed"
          actionLabel="Try again"
          onAction={() => props.onRetryPayment(stage)}
        >
          {stage.message}
        </InfoScreen>
      );
  }
}

function receiptIdempotencyKey(parsed: ParsedTseQr): string {
  return `paidReceipt:${parsed.kassenSerial}:${parsed.transactionNumber}:${parsed.signatureCounter}`;
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

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function BalancePreview({ balance }: { balance: PaymentBalanceState }) {
  if (balance.kind === "available") {
    return (
      <p className="balance-row">
        Your balance: {formatPusdSmallestUnit(balance.availableUnits)} pUSD
      </p>
    );
  }
  if (balance.kind === "pending") {
    return <p className="balance-row balance-row--muted">Checking balance…</p>;
  }
  if (balance.kind === "permissionDenied") {
    return (
      <p className="balance-row balance-row--muted">
        Balance check declined — payments will still verify with the host.
      </p>
    );
  }
  if (balance.kind === "error") {
    return (
      <p className="balance-row balance-row--muted">
        Balance check unavailable ({balance.reason}).
      </p>
    );
  }
  return null;
}

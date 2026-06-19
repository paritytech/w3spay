// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Customer-flow transition callbacks. The *decisions* come from the pure,
 * tested functions in `stage.ts` / `error-messages.ts`; this hook only
 * carries them out: write the stage payload to the session store, navigate
 * to its route (or the index for gate stages, where `<HostGate>` renders
 * from live host state), drive the send-payment mutation plus
 * fire-and-forget local persistence, and emit telemetry.
 *
 * Returned action identities are stable (a thin wrapper over a per-render
 * impl ref) so memoised consumers don't re-bind every render while the
 * closures always read fresh state.
 */

import { useMemo, useRef } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { captureError } from "@/telemetry";

import { envConfig } from "@/config";
import { type MerchantDestination } from "@/features/merchants/lib/destination.ts";
import { useHostAuth } from "@/features/host/api/host-auth.ts";
import { getTerminalStore } from "@/features/host/lib/terminal-store.ts";
import {
  merchantTableQueryOptions,
  merchantDryRunOrigin,
  useMerchantTable,
} from "@/features/merchants/api/queries.ts";
import {
  useSaveReceipt,
  useSendPayment,
} from "@/features/payment/api/mutations.ts";
import { journeyTracker } from "@/shared/utils/telemetry.ts";
import { dispatchScannedPayload, type ScanResult } from "@/features/scan/lib/dispatcher.ts";
import type { MerchantEntry, MerchantTable } from "@/features/merchants/types.ts";
import type { ParsedTseQr } from "@/features/scan/lib/tse-parser.ts";
import type { ParsedTerminalPayQr } from "@/features/scan/lib/terminal-pay-parser.ts";
import { messageFromError } from "@/shared/utils/error-message.ts";

import {
  derivePayErrorStage,
  resolveMerchantStageAfterLoad,
  stageOnGraceExpiry,
  type AppStage,
} from "@/features/payment/lib/stage.ts";
import {
  categorizePayError,
  classifyPaymentError,
  receiptIdempotencyKey,
} from "@/features/payment/lib/error-messages.ts";
import { useSessionStore } from "@/features/payment/store/session-store.ts";
import { FLOW_PATH, isFlowStage } from "@/features/payment/lib/route-from-stage.ts";

export interface PaymentActions {
  /** Classify a decoded QR and route to the matching stage. */
  handleDecoded(rawText: string): void;
  /** Return to a fresh scan, clearing any in-flight flow payload. */
  startScan(): void;
  /** Run the merchant TSE payment through the host. */
  performPayment(
    parsed: ParsedTseQr,
    merchant: MerchantEntry,
    tipCents: number,
  ): Promise<void>;
  /** Enter the dev-only manual-payment override. */
  startDevPay(): void;
  /** Run a dev-only manual payment through the same host path. */
  performDevPayment(
    destinationHex: string,
    amountCents: number,
  ): Promise<void>;
  /** Navigate to a stage (flow stage → its route; gate stage → index). */
  goToStage(stage: AppStage): void;
  /** Flush the scan grace window into the right error/empty stage. */
  flushScanGrace(): void;
  /** Run a t3rminal-pay deeplink payment through the host. */
  performTerminalPayment(
    qr: ParsedTerminalPayQr,
    merchant: MerchantEntry | null,
  ): Promise<void>;
}

export function usePaymentActions(): PaymentActions {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { state: authState } = useHostAuth();
  const { source: merchantTableSource } = useMerchantTable();

  const sendPaymentMutation = useSendPayment();
  const saveReceiptMutation = useSaveReceipt();

  const {
    setFlow,
    setLastQrText,
    setLastBadScan,
    setResolving,
    resetScan,
  } = useSessionStore.getState();

  // Per-render impl: fresh closures over the latest navigate / mutations /
  // host state. The returned wrapper delegates here so action identities
  // stay stable across renders.
  const implRef = useRef<PaymentActions>(null as unknown as PaymentActions);

  const navigateForStage = (stage: AppStage): void => {
    if (isFlowStage(stage)) {
      setFlow(stage);
      void navigate({ to: FLOW_PATH[stage.kind] });
      return;
    }
    // Gate stage (needsLogin / hostUnavailable / boot / needsCamera /
    // scanning): drop the flow payload and return to the index; the gate
    // renders the right screen from live host state.
    resetScan();
    void navigate({ to: "/" });
  };

  const onScanScreen = (): boolean =>
    router.state.location.pathname === "/" &&
    !useSessionStore.getState().resolving;

  /** Scan the merchant table for the first entry whose terminalId matches. */
  const findByTerminalId = (
    table: MerchantTable,
    terminalId: string,
  ): MerchantEntry | null =>
    Object.values(table).find((m) => m.terminalId === terminalId) ?? null;


  const handleDecoded = (rawText: string): void => {
    const trimmed = rawText.trim();
    setLastQrText(trimmed);
    const result: ScanResult = dispatchScannedPayload(trimmed);

    // A `t3rminal-receipt` is its own happy path: persist locally and
    // confirm immediately, regardless of the current screen.
    if (result.kind === "receipt") {
      journeyTracker.milestone("w3spay:qr-scan", "qr-decoded");
      journeyTracker.complete("w3spay:qr-scan", { "scan.outcome": "receipt-saved" });
      saveReceiptMutation.mutate({
        receipt: result.payload,
        savedAt: new Date().toISOString(),
        rawQrText: trimmed.length > 0 ? trimmed : undefined,
      });
      navigateForStage({ kind: "receiptSaved", receipt: result.payload });
      return;
    }
    if (result.kind === "receiptInvalid") {
      navigateForStage({
        kind: "scanError",
        message:
          "Couldn't read that receipt code. Make sure it's a t3rminal receipt and try again.",
      });
      return;
    }

    // Non-TSE results: while actively scanning, queue and let the grace
    // timer surface them; elsewhere (e.g. dev-hooks dispatch) fail fast.
    if (result.kind === "unsupported") {
      if (onScanScreen()) {
        setLastBadScan({ kind: "unsupported", reason: result.reason, raw: result.raw });
        return;
      }
      navigateForStage({ kind: "unsupportedScan", reason: result.reason, raw: result.raw });
      return;
    }
    if (result.kind === "invalid") {
      if (onScanScreen()) {
        setLastBadScan({ kind: "invalid", message: result.error.message });
        return;
      }
      navigateForStage({
        kind: "scanError",
        message: `Could not parse receipt QR: ${result.error.message}`,
      });
      return;
    }

  // t3rminal-pay deeplink — look up the merchant by terminalId and route
  // to the confirm screen. No idempotency check (no transaction number).
  if (result.kind === "terminalPay") {
    journeyTracker.milestone("w3spay:qr-scan", "qr-decoded");
    journeyTracker.complete("w3spay:qr-scan", { "scan.outcome": "terminal-pay" });
    setResolving(true);
    void (async () => {
      const origin = merchantDryRunOrigin(envConfig.chain.readOnlyOrigin);
      let table: MerchantTable;
      try {
        ({ table } = await queryClient.ensureQueryData(merchantTableQueryOptions(origin)));
      } catch {
        table = {};
      }
      const merchant = findByTerminalId(table, result.payload.terminalId);
      navigateForStage({ kind: "terminalPayConfirm", qr: result.payload, merchant });
    })();
    return;
  }


    // Valid TSE — the qr-scan happy path. The next transition is the
    // merchant-resolution path, a separate concern from the scan.
    journeyTracker.milestone("w3spay:qr-scan", "qr-decoded");
    journeyTracker.complete("w3spay:qr-scan", { "scan.outcome": "tse-valid" });
    const parsed = result.payload;
    const idempotencyKey = receiptIdempotencyKey(parsed);

    // Show the boot splash (and unmount the camera) while we resolve the
    // idempotency lookup + merchant table.
    setResolving(true);
    void (async () => {
      let existing: string | null = null;
      try {
        existing = (await getTerminalStore().get(idempotencyKey)) ?? null;
      } catch (caught) {
        console.warn(
          "[w3spay/scan] idempotency read failed; proceeding without",
          caught,
        );
        captureError(caught, { subsystem: "idempotency", op: "read" });
      }

      // Await the merchant table via the shared query cache — resolves
      // instantly when already loaded, otherwise waits for the boot fetch.
      const origin = merchantDryRunOrigin(envConfig.chain.readOnlyOrigin);
      let table;
      try {
        ({ table } = await queryClient.ensureQueryData(
          merchantTableQueryOptions(origin),
        ));
      } catch {
        table = {};
      }

      const next = resolveMerchantStageAfterLoad(
        table,
        { parsed, existingPaymentId: existing },
        envConfig.merchant.pilotId,
        envConfig.features.tipScreen,
      );
      // `table` is non-null here, so `resolveMerchantStageAfterLoad` never
      // returns null; the guard keeps TS honest.
      if (next !== null) navigateForStage(next);
      else setResolving(false);
    })();
  };

  const startScan = (): void => {
    resetScan();
    void navigate({ to: "/" });
  };

  const performPayment = async (
    parsed: ParsedTseQr,
    merchant: MerchantEntry,
    tipCents: number,
  ): Promise<void> => {
    const totalCents = parsed.amountCents + tipCents;
    journeyTracker.start("w3spay:customer-pay", {
      "payment.tipped": tipCents > 0,
      "payment.table_source": merchantTableSource ?? "unknown",
      "payment.amount_cents": totalCents,
    });
    navigateForStage({ kind: "paying", parsed, merchant, tipCents });

    let payment;
    try {
      payment = await sendPaymentMutation.mutateAsync({
        amountCents: totalCents,
        merchantDestination: merchant.destination,
      });
    } catch (caught) {
      // Classify + route on the freshest auth state so a sign-out
      // mid-payment lands on sign-in / host-unavailable, not a generic
      // payError.
      journeyTracker.fail("w3spay:customer-pay", categorizePayError(caught, authState), caught);
      navigateForStage(derivePayErrorStage(caught, authState, parsed, merchant, tipCents));
      return;
    }

    journeyTracker.milestone("w3spay:customer-pay", "payment-submitted");
    // CRITICAL: navigate to `done` BEFORE any persistence. The host has
    // moved money; a local-write failure must never read back as payError.
    journeyTracker.complete("w3spay:customer-pay", {
      "payment.settlement": payment.settlement === "unconfirmed" ? "unconfirmed" : "settled",
      // `unconfirmed` = host accepted but never terminally confirmed (money may
      // have moved) — the payer-side "didn't fully complete" signal.
      "payment.outcome": payment.settlement === "unconfirmed" ? "unconfirmed" : "settled",
      "payment.sad": payment.settlement === "unconfirmed" ? "true" : "false",
    });
    navigateForStage({ kind: "done", parsed, merchant, tipCents, payment });

    // Persistence after the navigation — both fire-and-forget. The
    // send mutation already invalidated the balance.
    void (async () => {
      try {
        await getTerminalStore().set(receiptIdempotencyKey(parsed), payment.paymentId);
      } catch (caught) {
        console.warn(
          "[w3spay/scan] idempotency write failed; rescan may re-show confirm",
          caught,
        );
        captureError(caught, { subsystem: "idempotency", op: "write" });
      }
    })();
  };

  const startDevPay = (): void => {
    navigateForStage({ kind: "devPay" });
  };

  const performDevPayment = async (
    destinationHex: string,
    amountCents: number,
  ): Promise<void> => {
    journeyTracker.start("w3spay:dev-pay");
    navigateForStage({ kind: "devPaying", amountCents, destinationHex });

    let payment;
    try {
      payment = await sendPaymentMutation.mutateAsync({
        amountCents,
        merchantDestination: { kind: "accountId32", value: destinationHex },
      });
    } catch (caught) {
      const variant = classifyPaymentError(caught);
      journeyTracker.fail("w3spay:dev-pay", variant ? `coin-${variant}` : "unknown", caught);
      // Dev surface: show the real host reason, not the friendly copy.
      const message = messageFromError(caught, "Payment couldn't go through. Try again.");
      navigateForStage({ kind: "devPayError", message, amountCents, destinationHex });
      return;
    }

    journeyTracker.milestone("w3spay:dev-pay", "payment-submitted");
    journeyTracker.complete("w3spay:dev-pay", {
      "payment.settlement": payment.settlement === "unconfirmed" ? "unconfirmed" : "settled",
    });
    navigateForStage({
      kind: "devDone",
      amountCents,
      destinationHex,
      paymentId: payment.paymentId,
    });
  };

  const flushScanGrace = (): void => {
    const captured = useSessionStore.getState().lastBadScan;
    const reason =
      captured == null
        ? "empty"
        : captured.kind === "invalid"
          ? "invalid"
          : "unsupported";
    journeyTracker.fail("w3spay:qr-scan", reason, undefined, { "scan.outcome": reason });
    navigateForStage(stageOnGraceExpiry(captured));
  };

  const performTerminalPayment = async (
    qr: ParsedTerminalPayQr,
    merchant: MerchantEntry | null,
  ): Promise<void> => {
    navigateForStage({ kind: "terminalPayPaying", qr, merchant });

    // Destination: prefer the registry entry, fall back to the QR address.
    const destination: MerchantDestination = merchant
      ? merchant.destination
      : { kind: "accountId32", value: qr.addressHex };

    let payment;
    try {
      payment = await sendPaymentMutation.mutateAsync({
        amountCents: qr.amountCents,
        merchantDestination: destination,
      });
    } catch (caught) {
      const message = messageFromError(caught, "Payment couldn't go through. Try again.");
      navigateForStage({ kind: "scanError", message });
      return;
    }

    navigateForStage({ kind: "terminalPayDone", qr, merchant, payment });
  };


  implRef.current = {
    handleDecoded,
    startScan,
    performPayment,
    startDevPay,
    performDevPayment,
    goToStage: navigateForStage,
    flushScanGrace,
    performTerminalPayment,
  };

  return useMemo<PaymentActions>(
    () => ({
      handleDecoded: (raw) => implRef.current.handleDecoded(raw),
      startScan: () => implRef.current.startScan(),
      performPayment: (parsed, merchant, tipCents) =>
        implRef.current.performPayment(parsed, merchant, tipCents),
      startDevPay: () => implRef.current.startDevPay(),
      performDevPayment: (destinationHex, amountCents) =>
        implRef.current.performDevPayment(destinationHex, amountCents),
      goToStage: (stage) => implRef.current.goToStage(stage),
      flushScanGrace: () => implRef.current.flushScanGrace(),
      performTerminalPayment: (qr, merchant) =>
        implRef.current.performTerminalPayment(qr, merchant),
    }),
    [],
  );
}

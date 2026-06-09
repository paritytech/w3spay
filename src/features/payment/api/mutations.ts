// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Write-side payment hooks as TanStack Query mutations, wrapping the
 * framework-free data functions and owning each write's cache invalidation
 * so the read queries refresh automatically:
 *
 *   - `useSendPayment`   — host round-trip.
 *   - `useSaveReceipt`   — local saved-receipt store; invalidates Receipts.
 *
 * Orchestration (telemetry, navigation, idempotency ordering) lives in
 * `usePaymentActions`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  sendPayment,
  type SendPaymentInput,
  type SendPaymentResult,
} from "@/features/payment/api/send-payment.ts";
import { saveReceipt, type ReceiptRecord } from "@/features/wallet/api/receipts.ts";
import { getTerminalStore } from "@/features/host/lib/terminal-store.ts";
import { walletKeys } from "@/features/wallet/api/keys.ts";

/** Host-routed payment. */
export function useSendPayment() {
  return useMutation<SendPaymentResult, Error, SendPaymentInput>({
    mutationFn: (input) => sendPayment(input),
  });
}

/**
 * Save a scanned `t3rminal-receipt` locally and refresh the Receipts list.
 * `saveReceipt` is best-effort and never throws.
 */
export function useSaveReceipt() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ReceiptRecord>({
    mutationFn: (record) => saveReceipt(getTerminalStore(), record),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: walletKeys.receipts() });
    },
  });
}

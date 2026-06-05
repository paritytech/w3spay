/**
 * Payment detail page — `/wallet/payment/$paymentId`.
 *
 * Looks the record up by id from `usePaymentHistory()`. A missing id
 * (deleted record / bad deep link) replaces back to the wallet list so
 * we never strand the user on an empty detail. Reload-safe because the
 * KvStore is the source of truth, not a passed-in record.
 */

import { useEffect } from "react";

import { useNavigate, useParams, useRouter } from "@tanstack/react-router";

import { PATHS } from "@/app/router/routes.ts";
import { paymentDetailRoute } from "@/features/wallet/routes.tsx";
import { usePaymentHistory } from "@/features/wallet/api/queries.ts";
import { PaymentReceiptScreen } from "@/features/wallet/components/PaymentReceiptScreen.tsx";
import { BootScreen } from "@/features/host/components/BootScreen.tsx";

export function PaymentDetailPage() {
  const { paymentId } = useParams({ from: paymentDetailRoute.id });
  const navigate = useNavigate();
  const router = useRouter();
  const { data, isPending } = usePaymentHistory();
  const record = data?.find((r) => r.paymentId === paymentId);

  useEffect(() => {
    if (!isPending && record === undefined) {
      void navigate({ to: PATHS.wallet, search: { tab: "activity" }, replace: true });
    }
  }, [isPending, record, navigate]);

  if (record === undefined) return <BootScreen />;
  return <PaymentReceiptScreen record={record} onBack={() => router.history.back()} />;
}

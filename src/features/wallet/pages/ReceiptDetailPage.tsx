/**
 * Receipt detail page — `/wallet/receipt/$saleId`.
 *
 * Looks the record up by id from `useReceipts()`. A missing id replaces
 * back to the wallet list. Reload-safe by KvStore lookup, not by passed-
 * in record state.
 */

import { useEffect } from "react";

import { useNavigate, useParams, useRouter } from "@tanstack/react-router";

import { PATHS } from "@/app/router/routes.ts";
import { receiptDetailRoute } from "@/features/wallet/routes.tsx";
import { useReceipts } from "@/features/wallet/api/queries.ts";
import { ReceiptDetailScreen } from "@/features/wallet/components/ReceiptDetailScreen.tsx";
import { BootScreen } from "@/features/host/components/BootScreen.tsx";

export function ReceiptDetailPage() {
  const { saleId } = useParams({ from: receiptDetailRoute.id });
  const navigate = useNavigate();
  const router = useRouter();
  const { data, isPending } = useReceipts();
  const record = data?.find((r) => r.receipt.saleId === saleId);

  useEffect(() => {
    if (!isPending && record === undefined) {
      void navigate({ to: PATHS.wallet, search: { tab: "receipts" }, replace: true });
    }
  }, [isPending, record, navigate]);

  if (record === undefined) return <BootScreen />;
  return <ReceiptDetailScreen record={record} onBack={() => router.history.back()} />;
}

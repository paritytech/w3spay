/**
 * Top-level provider composition.
 *
 * One place to add / remove provider context that the whole app needs.
 * Currently: `<QueryClientProvider>` for TanStack Query. The router has
 * its own `<RouterProvider>` (mounted by `<AppRouter>` in
 * `app/router/index.tsx`) and is composed by `<App>` below; Zustand
 * stores are providerless module singletons and don't appear here.
 */

import type { ReactNode } from "react";

import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "@/shared/api/query-client.ts";

export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

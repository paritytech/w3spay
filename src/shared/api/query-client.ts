/**
 * TanStack Query client singleton.
 *
 * Created once at module load and shared through `<QueryClientProvider>`
 * in `app/providers.tsx`. Defaults are tuned for a host-embedded PWA:
 * host / merchant / balance data is fetched on demand and explicitly
 * invalidated by mutations, so `staleTime` is generous and refetch on
 * focus / reconnect is off — a backgrounded mobile webview regaining
 * focus must NOT re-poll the chain. Individual hooks override
 * `staleTime` / `refetchInterval` where their semantics differ (the host
 * resolution poll, the balance refresh-after-pay).
 *
 * Query keys live in each feature's `api/keys.ts` — keep them there so a
 * feature's reads and the mutations that invalidate them stay coupled.
 */

import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

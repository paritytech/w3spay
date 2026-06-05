/**
 * Payment-session store (Zustand) — the in-flight customer flow's client
 * state, the part that must survive route changes.
 *
 * Replaces the data-carrying half of the old `StageProvider`:
 *
 *   - `flow`        — the active flow stage's payload (parsed receipt,
 *                     merchant, tip, payment result, dev-pay fields, …).
 *                     The route reflects `flow`'s kind; the two are written
 *                     together by `usePaymentActions` and reconciled by
 *                     each route's entry guard.
 *   - `lastQrText`  — verbatim text of the most recent decode. Captured at
 *                     scan time, read later when persisting the payment /
 *                     receipt so the detail view can re-render the QR.
 *   - `lastBadScan` — most recent non-TSE decode seen during the scan
 *                     grace window; the grace timer flushes it into the
 *                     right error stage if no valid receipt lands in time.
 *   - `resolving`   — true while the scan flow is resolving a decoded TSE
 *                     (idempotency + merchant lookup); the scan route shows
 *                     the boot splash and unmounts the camera meanwhile.
 *
 * A module-level store (not context): a single customer drives one flow,
 * and the route guards read `getState()` synchronously at navigation time.
 */

import { create } from "zustand";

import type { LastBadScan } from "@/features/payment/lib/stage.ts";
import type { FlowStage } from "@/features/payment/lib/route-from-stage.ts";

interface SessionState {
  readonly flow: FlowStage | null;
  readonly lastQrText: string | null;
  readonly lastBadScan: LastBadScan | null;
  readonly resolving: boolean;
  /** Set the active flow payload. Clears `resolving` (we've left the splash). */
  setFlow(flow: FlowStage | null): void;
  setLastQrText(text: string | null): void;
  setLastBadScan(scan: LastBadScan | null): void;
  setResolving(resolving: boolean): void;
  /** Reset everything the scan screen owns when starting a fresh scan. */
  resetScan(): void;
}

export const useSessionStore = create<SessionState>((set) => ({
  flow: null,
  lastQrText: null,
  lastBadScan: null,
  resolving: false,
  setFlow: (flow) => set({ flow, resolving: false }),
  setLastQrText: (lastQrText) => set({ lastQrText }),
  setLastBadScan: (lastBadScan) => set({ lastBadScan }),
  setResolving: (resolving) => set({ resolving }),
  resetScan: () => set({ flow: null, lastBadScan: null, resolving: false }),
}));

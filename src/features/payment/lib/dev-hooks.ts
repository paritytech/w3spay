/**
 * Dev-standalone escape hatch.
 *
 * `vite dev` runs on plain HTTP, so on non-localhost origins
 * `getUserMedia` is blocked and the camera screen never advances.
 * `useDevHooks` wires three console-callable helpers so the full
 * scan → confirm → done flow can be driven from devtools without a real
 * camera:
 *
 *   window.__w3spayDevDispatchScan("V0;…;BASE64KEY")  — paste a TSE QR
 *   window.__w3spayDevStartScan()                     — reset to scanning
 *   window.__w3spayDevClearStorage()                  — drop `w3spay:*`
 *
 * Tree-shaken out of prod builds by the `isDevStandalone()` gate.
 */

import { isDevStandalone } from "@/shared/api/host";
import { useEffect } from "react";


interface DevWindow extends Window {
  __w3spayDevDispatchScan?: (raw: string) => void;
  __w3spayDevStartScan?: () => void;
  __w3spayDevClearStorage?: () => number;
}

export interface DevHooksOptions {
  handleDecoded: (raw: string) => void;
  startScan: () => void;
}

/** Bind the `window.__w3spayDev*` helpers for the lifetime of the caller. */
export function useDevHooks({ handleDecoded, startScan }: DevHooksOptions): void {
  useEffect(() => {
    if (!isDevStandalone()) return;
    const win = window as DevWindow;
    win.__w3spayDevDispatchScan = handleDecoded;
    win.__w3spayDevStartScan = startScan;
    win.__w3spayDevClearStorage = () => {
      const keys = Object.keys(window.localStorage).filter((k) => k.startsWith("w3spay:"));
      for (const key of keys) window.localStorage.removeItem(key);
      console.info(
        `[w3spay/dev] cleared ${keys.length} localStorage entries — reload to reset the in-memory balance.`,
      );
      return keys.length;
    };
    console.info(
      "[w3spay/dev] devtools hooks ready — window.__w3spayDev{DispatchScan(rawQr), StartScan(), ClearStorage()}",
    );
    return () => {
      delete win.__w3spayDevDispatchScan;
      delete win.__w3spayDevStartScan;
      delete win.__w3spayDevClearStorage;
    };
  }, [handleDecoded, startScan]);
}

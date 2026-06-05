/**
 * `@/sdk/host/debug` — host-debug overlay for products that run
 * inside a Polkadot host.
 *
 * Exports:
 *   - `DebugPanel` — the floating toolbox button + draggable overlay
 *   - `installConsoleCapture` — install the global `console.*` /
 *     `window.onerror` / `unhandledrejection` capture (idempotent)
 *   - `debugStore` — module-level singleton with the captured state
 *   - The `DebugLogLevel` / `DebugLogRecord` / `DebugBootEvent` /
 *     `DebugStoreState` / `DebugHostSnapshot` types for consumers
 *     that want to subscribe via their own UI
 *
 * The panel is intentionally decoupled from `wallet.ts` — it imports
 * `useHostWallet` lazily (inside a React effect) so the store can
 * stay testable without a React renderer and so the capture can
 * install in a browser environment without depending on the wallet
 * module's transitive imports.
 *
 * Production usage:
 *   import { DebugPanel } from "@/sdk/host/debug";
 *
 *   function App() {
 *     return (
 *       <>
 *         ...
 *         <DebugPanel />
 *       </>
 *     );
 *   }
 *
 * Gating (recommended): wrap the mount in an env-flag check so the
 * panel only renders on dev/staging. Production builds should NOT
 * ship the toolbox button.
 */

export {
  debugStore,
  type DebugLogLevel,
  type DebugLogRecord,
  type DebugBootEvent,
  type DebugHostSnapshot,
  type DebugStoreState,
  type WalletPhase,
} from "./debug-store.ts";

export {
  installConsoleCapture,
  __uninstallConsoleCaptureForTests,
} from "./console-capture.ts";

export { DebugPanel, type DebugPanelProps } from "./DebugPanel.tsx";

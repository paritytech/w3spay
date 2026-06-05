/**
 * Module-level singleton state for the debug panel.
 *
 * Two streams of data:
 *
 *   1. **Console logs** — populated by `console-capture.ts` which
 *      monkey-patches `console.*` + `window.onerror` +
 *      `unhandledrejection`. Stored in a ring buffer (capacity
 *      controlled at append time) so the panel can scroll through the
 *      last N entries.
 *
 *   2. **Boot events** — explicit `recordBootEvent()` calls from the
 *      wallet store's `initInternal`. These are the high-signal
 *      markers the panel renders as a separate "timeline" tab so a
 *      user can see at a glance which phase the boot is in without
 *      grepping the console stream.
 *
 *   3. **Host state snapshot** — set by the panel itself by calling
 *      `setHostSnapshot()` from a React effect that consumes
 *      `useHostWalletSnapshot()`. (The store is React-agnostic — it doesn't
 *      import from `wallet.ts` — to avoid a cycle.)
 *
 * The store exposes a `subscribe()` API so the panel can re-render on
 * any change. Implementation is a small `Set<() => void>` and a
 * `useSyncExternalStore`-friendly `getSnapshot()`.
 */

export type DebugLogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface DebugLogRecord {
  readonly id: number;
  readonly timestamp: number;
  readonly level: DebugLogLevel;
  readonly message: string;
  readonly source: "console" | "window" | "boot-event" | "manual";
}

export type WalletPhase =
  | "handshake"
  | "connect-host"
  | "inject-extension"
  | "get-product-account"
  | "build-signer"
  | "claim-allowances"
  | "ready"
  | "error";

export interface DebugBootEvent {
  readonly id: number;
  readonly timestamp: number;
  readonly phase: WalletPhase;
  readonly outcome: "start" | "ok" | "error";
  readonly message?: string;
}

export interface DebugHostSnapshot {
  readonly stateKind:
    | "outside-host"
    | "pending"
    | "resolving"
    | "ready"
    | "requesting-access"
    | "error";
  readonly phase?: WalletPhase;
  readonly address?: string;
  readonly errorReason?: string;
  readonly isReady: boolean;
  readonly isInitializing: boolean;
  readonly isOutsideHost: boolean;
  readonly allowanceCount: number;
  readonly environment: "desktop-webview" | "web-iframe" | "standalone";
  /** Snapshot timestamp — for "stale X seconds" rendering. */
  readonly updatedAt: number;
}

export interface DebugStoreState {
  readonly logs: readonly DebugLogRecord[];
  readonly bootEvents: readonly DebugBootEvent[];
  readonly hostSnapshot: DebugHostSnapshot | null;
  readonly installed: boolean;
}

const INITIAL: DebugStoreState = {
  logs: [],
  bootEvents: [],
  hostSnapshot: null,
  installed: false,
};

let logs: DebugLogRecord[] = [];
let bootEvents: DebugBootEvent[] = [];
let hostSnapshot: DebugHostSnapshot | null = null;
let installed = false;
let nextEventId = 0;
const subscribers = new Set<() => void>();

/**
 * Cached snapshot object. **Critical for `useSyncExternalStore`:** the
 * hook treats a new object identity (`Object.is`) as "the store
 * changed", and will re-render on every render where the snapshot
 * differs. If `getSnapshot()` returned a fresh object literal on each
 * call, the panel would infinite-loop because each render calls
 * `getSnapshot` and sees a "new" snapshot.
 *
 * The cache is invalidated only inside `notify()` — that's the single
 * place the store actually mutates. Reads via `getSnapshot()` between
 * mutations return the same reference.
 */
let cachedSnapshot: DebugStoreState = {
  logs,
  bootEvents,
  hostSnapshot,
  installed,
};

function notify(): void {
  // Refresh the cached object *before* notifying subscribers so the
  // snapshot they observe is consistent with the state they just got
  // notified about.
  cachedSnapshot = {
    logs: logs.slice(),
    bootEvents: bootEvents.slice(),
    hostSnapshot,
    installed,
  };
  for (const cb of subscribers) cb();
}

/** Append a console-log record. Trims `capacity` oldest if over. */
export function appendLog(entry: DebugLogRecord, capacity: number): void {
  logs.push(entry);
  if (logs.length > capacity) {
    logs = logs.slice(logs.length - capacity);
  }
  notify();
}

/** Append a boot-event marker. The wallet store calls this at each
 *  phase transition. */
export function recordBootEvent(
  phase: WalletPhase,
  outcome: DebugBootEvent["outcome"],
  message?: string,
): void {
  bootEvents.push({
    id: nextEventId,
    timestamp: Date.now(),
    phase,
    outcome,
    message,
  });
  nextEventId += 1;
  notify();
}

/** Update the host-state snapshot. The panel calls this from a React
 *  effect that consumes `useHostWalletSnapshot()`. */
export function setHostSnapshot(snapshot: DebugHostSnapshot | null): void {
  hostSnapshot = snapshot;
  notify();
}

/** Mark the capture as installed. The panel's auto-installer calls
 *  this on mount so the badge can render "Capture: ON". */
export function setInstalled(value: boolean): void {
  installed = value;
  notify();
}

/** Clear the console-log buffer. */
export function clearLogs(): void {
  logs = [];
  notify();
}

/** Clear the boot-event buffer. */
export function clearBootEvents(): void {
  bootEvents = [];
  notify();
}

/** Subscribe to store changes. Returns the unsubscribe. */
export function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/** Get a one-shot snapshot of the current state. */
export function getSnapshot(): DebugStoreState {
  return cachedSnapshot;
}

export const debugStore = {
  appendLog,
  recordBootEvent,
  setHostSnapshot,
  setInstalled,
  clearLogs,
  clearBootEvents,
  subscribe,
  getSnapshot,
};

export const __INITIAL_DEBUG_STATE = INITIAL;

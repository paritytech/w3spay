/**
 * Console output capture — monkey-patches `console.log/info/warn/error`
 * and the `window.onerror` / `unhandledrejection` hooks so the debug
 * panel can display them.
 *
 * Why module-level state: a debugger panel that's invisible (i.e. the
 * toolbox button is closed) still needs to capture everything that
 * happened in the boot path. The capture starts as soon as the module
 * is imported; the panel just decides whether to surface the captured
 * events.
 *
 * The captured events flow into a ring buffer inside `debug-store.ts`.
 * The original `console.*` methods are preserved and called too — the
 * capture is additive, not replacing. (Replacing would break Sentry's
 * `beforeSend` console-instrumentation integration.)
 *
 * Capping the buffer at a fixed size matters: the host-API SDK can
 * produce dozens of lines per second on iOS during the webview-port
 * bring-up. Unbounded growth would crash the SPA.
 */

import {
  debugStore,
  setInstalled,
  type DebugLogLevel,
  type DebugLogRecord,
} from "./debug-store.ts";

const ORIGINAL_METHODS = new Map<DebugLogLevel, (...args: unknown[]) => void>();
type WindowOnError = Window["onerror"];
type WindowOnUnhandledRejection = Window["onunhandledrejection"];
let originalOnError: WindowOnError = null;
let originalOnUnhandledRejection: WindowOnUnhandledRejection = null;
let installed = false;

/**
 * Maximum number of records the ring buffer keeps. Past this, the
 * oldest entries are dropped. Sized to give ~30s of activity at the
 * noisy boot cadence; raise if the iOS bring-up logs are still being
 * truncated in practice.
 */
const RING_BUFFER_CAPACITY = 2000;

const FORMATTABLE_LEVELS: ReadonlyArray<DebugLogLevel> = ["log", "info", "warn", "error", "debug"];

/**
 * Stringify a list of `console.*` arguments. We try to be faithful to
 * the native rendering — strings and numbers render verbatim, objects
 * get a single-level JSON.stringify, Errors get `name + message + stack`.
 */
function formatArgs(args: unknown[]): string {
  const out: string[] = [];
  for (const arg of args) {
    if (typeof arg === "string") {
      out.push(arg);
    } else if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") {
      out.push(String(arg));
    } else if (arg === null) {
      out.push("null");
    } else if (arg === undefined) {
      out.push("undefined");
    } else if (arg instanceof Error) {
      const stack = arg.stack ? `\n${arg.stack}` : "";
      out.push(`${arg.name}: ${arg.message}${stack}`);
    } else {
      try {
        out.push(JSON.stringify(arg, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
      } catch {
        out.push(String(arg));
      }
    }
  }
  return out.join(" ");
}

/**
 * Push a record into the ring buffer. The store trims to capacity and
 * notifies any subscribers (the debug panel UI) on the next microtask
 * so a rapid burst of console output doesn't trigger one React
 * re-render per call.
 */
function record(level: DebugLogLevel, message: string, source: DebugLogRecord["source"]): void {
  const entry: DebugLogRecord = {
    id: nextId(),
    timestamp: Date.now(),
    level,
    source,
    message,
  };
  debugStore.appendLog(entry, RING_BUFFER_CAPACITY);
}

let counter = 0;
function nextId(): number {
  counter += 1;
  return counter;
}

/**
 * Install the global capture. Idempotent — safe to call multiple times
 * (e.g. from a hot-reload). The capture stays installed across the
 * page's lifetime; production callers should NOT install unless the
 * debug panel is expected to surface, since the ring buffer costs
 * memory.
 */
export function installConsoleCapture(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  // The `Console` interface's method signatures are all slightly
  // different; index via a loose record so we can install a single
  // uniform capture for every level. The original method is invoked
  // verbatim via `.call`, preserving its native signature.
  const consoleRecord = console as unknown as Record<
    DebugLogLevel,
    (...args: unknown[]) => void
  >;

  for (const level of FORMATTABLE_LEVELS) {
    // Capture the original unbound. We DON'T `.bind(console)` here
    // because that would add a new bind layer on every install, and
    // a re-install would re-bind a re-bound function — eventually
    // piling up `bound bound bound` wrappers. Call the original via
    // `Function.prototype.call(console, ...args)` instead so the
    // recorded `console` binding matches the unmocked case.
    const original = (consoleRecord[level] ?? (() => undefined)) as (
      ...args: unknown[]
    ) => void;
    ORIGINAL_METHODS.set(level, original);
    consoleRecord[level] = (...args: unknown[]) => {
      record(level, formatArgs(args), "console");
      // Preserve native rendering so Sentry's beforeBreadcrumb integration
      // and the dev's normal debugging both keep working.
      original.apply(console, args);
    };
  }

  // Mark the store as installed so the panel's "CAPTURE" badge flips.
  setInstalled(true);

  // Capture window.onerror — last-ditch uncaught throw handler.
  originalOnError = window.onerror;
  window.onerror = function (message, source, lineno, colno, error) {
    const text = typeof message === "string" ? message : String(message);
    record(
      "error",
      `window.onerror: ${text} (${source}:${lineno}:${colno})${error ? "\n" + (error.stack ?? error.message ?? "") : ""}`,
      "window",
    );
    if (originalOnError) {
      return originalOnError.call(this, message, source, lineno, colno, error);
    }
    return false;
  };

  // Capture unhandledrejection — async throws that escape the promise chain.
  originalOnUnhandledRejection = window.onunhandledrejection;
  window.onunhandledrejection = (event) => {
    const reason = event?.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    record("error", `unhandledrejection: ${message}${reason instanceof Error && reason.stack ? "\n" + reason.stack : ""}`, "window");
    if (typeof originalOnUnhandledRejection === "function") {
      return originalOnUnhandledRejection.call(window, event);
    }
    return undefined;
  };
}

/**
 * Tear down the capture. Test-only. Production code MUST NOT call this
 * — the panel expects to see the full boot path even when the button
 * is closed, so the capture stays installed for the page lifetime.
 */
export function __uninstallConsoleCaptureForTests(): void {
  if (!installed) return;
  installed = false;
  const consoleRecord = console as unknown as Record<
    DebugLogLevel,
    (...args: unknown[]) => void
  >;
  for (const level of FORMATTABLE_LEVELS) {
    const original = ORIGINAL_METHODS.get(level);
    if (original) consoleRecord[level] = original;
  }
  ORIGINAL_METHODS.clear();
  if (window.onerror && originalOnError) {
    window.onerror = originalOnError;
  }
  if (originalOnUnhandledRejection !== null) {
    window.onunhandledrejection = originalOnUnhandledRejection;
  }
  originalOnError = null;
  originalOnUnhandledRejection = null;
}

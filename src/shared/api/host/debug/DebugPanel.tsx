/**
 * Debug overlay panel — a floating "toolbox" button that opens a
 * console / timeline / host-state / actions panel.
 *
 * Designed for mobile-host debugging. The host's mobile webview ships
 * only the built SPA — there's no DevTools to peek at. The button +
 * panel can ride along in production builds, gated by an env flag, so
 * a "stuck on boot splash" issue on iOS can be diagnosed without
 * redeploying.
 *
 * Tabs:
 *   - **Console**  — `console.*` / `window.onerror` /
 *     `unhandledrejection` capture, color-coded by level, filterable.
 *   - **Timeline** — boot-event markers recorded by `wallet.ts`'s
 *     `initInternal`, with `+Xms` deltas.
 *   - **Host**     — live `useHostWalletSnapshot()` snapshot.
 *   - **Actions**  — manual controls: retry / reset / clear / copy.
 *
 * Copy + dump:
 *
 *   Every tab exposes two ways to lift data out of the panel — the
 *   first is for desktop / Android / Safari, the second is the iOS
 *   fallback when `navigator.clipboard.writeText` is blocked by the
 *   lack of a user gesture.
 *
 *   - **Copy** (visible) — copy the filtered subset (or all if no
 *     filter) to the clipboard via the async Clipboard API. The
 *     write happens inside a button click so the user-gesture
 *     requirement is satisfied.
 *   - **Copy ALL** — copy the entire ring buffer, ignoring the
 *     filter. Useful when the user has narrowed the console to
 *     "boot" lines but the bug is actually in a different stream.
 *   - **Open dump** — open a modal with a `<textarea>` containing
 *     the full dump. On iOS the user can long-press → "Select All"
 *     → "Copy" without needing clipboard API access. The modal also
 *     has a "Download" button that triggers a Blob download — works
 *     on Android / desktop where the user prefers a file.
 *
 * Design notes:
 *
 *   - The panel's `getSnapshot` is referentially stable between
 *     store updates (the store caches its snapshot object). This is
 *     **required** for `useSyncExternalStore` to not re-render on
 *     every render — earlier revisions returned a fresh object
 *     literal and the panel re-rendered in a tight loop, lagging
 *     the SPA.
 *   - All positioning is `position: fixed` with z-index 999999 so
 *     the panel survives scroll and sits above any app chrome.
 *   - Drag handle is the panel header. The toolbox button (closed
 *     state) is a fixed sibling at the bottom-right.
 *   - The capture (`installConsoleCapture`) is module-level and
 *     idempotent — it stays installed for the page lifetime once
 *     the panel mounts, so the user can close the panel and reopen
 *     it without losing the captured stream.
 */

import * as React from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { detectHostEnvironment } from "../connection.ts";
import { retryHostWallet, __resetHostWalletForTests, useHostWalletSnapshot } from "../wallet.ts";
import {
  debugStore,
  installConsoleCapture,
  __uninstallConsoleCaptureForTests,
  type DebugBootEvent,
  type DebugLogLevel,
  type DebugLogRecord,
  type DebugStoreState,
} from "./index.ts";

// ── Constants ──────────────────────────────────────────────────────

const PANEL_DEFAULT_POSITION = { right: 16, bottom: 16 };
const PANEL_DEFAULT_SIZE = { width: 480, height: 520 };
const DRAG_THRESHOLD_PX = 3;

// Resize constraints. Min keeps the panel readable on a phone in
// landscape (a smaller panel is just a chrome strip); max is
// viewport minus 16px margin on each side so the panel can be
// made "near-fullscreen" without clipping the window edge.
const MIN_WIDTH = 240;
const MIN_HEIGHT = 200;
const VIEWPORT_MARGIN = 16;
const STORAGE_KEY = "w3spay-debug-panel:v1";

interface PersistedGeometry {
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function loadGeometry(): PersistedGeometry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as PersistedGeometry).right === "number" &&
      typeof (parsed as PersistedGeometry).bottom === "number" &&
      typeof (parsed as PersistedGeometry).width === "number" &&
      typeof (parsed as PersistedGeometry).height === "number"
    ) {
      return parsed as PersistedGeometry;
    }
  } catch {
    // Ignore — localStorage may throw in some sandboxed contexts
    // (e.g. private mode in Safari).
  }
  return null;
}

function saveGeometry(geom: PersistedGeometry): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(geom));
  } catch {
    // best-effort; ignore quota / private-mode failures.
  }
}

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface ResizeState {
  direction: ResizeDirection;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startRight: number;
  startBottom: number;
}

/**
 * Clamp a candidate (width, height) to the panel's min/max bounds.
 * Used both during resize (to keep the panel in view) and at mount
 * time (to re-fit a persisted geometry that was saved on a
 * different screen).
 */
function clampedSize(width: number, height: number): { width: number; height: number } {
  const maxW = (typeof window !== "undefined" ? window.innerWidth : 1200) - VIEWPORT_MARGIN * 2;
  const maxH = (typeof window !== "undefined" ? window.innerHeight : 800) - VIEWPORT_MARGIN * 2;
  return {
    width: Math.max(MIN_WIDTH, Math.min(maxW, Math.round(width))),
    height: Math.max(MIN_HEIGHT, Math.min(maxH, Math.round(height))),
  };
}

/**
 * Clamp a (right, bottom) anchor so the panel's left/top edges stay
 * inside the viewport even after a resize. The panel's left edge
 * is at `viewport.width - right - width`; the top edge is at
 * `viewport.height - bottom - height`. We don't allow these to
 * fall below 0.
 */
function clampedPosition(
  right: number,
  bottom: number,
  width: number,
  height: number,
): { right: number; bottom: number } {
  if (typeof window === "undefined") return { right, bottom };
  const maxRight = window.innerWidth - width - VIEWPORT_MARGIN;
  const maxBottom = window.innerHeight - height - VIEWPORT_MARGIN;
  return {
    right: Math.max(VIEWPORT_MARGIN, Math.min(maxRight, Math.round(right))),
    bottom: Math.max(VIEWPORT_MARGIN, Math.min(maxBottom, Math.round(bottom))),
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function levelColor(level: DebugLogLevel): string {
  switch (level) {
    case "error":
      return "#ff6b6b";
    case "warn":
      return "#ffd166";
    case "info":
      return "#7cc4ff";
    case "debug":
      return "#9aa5b1";
    case "log":
    default:
      return "#e6edf3";
  }
}

function phaseLabel(phase: string): string {
  return phase;
}

function outcomeColor(outcome: DebugBootEvent["outcome"]): string {
  switch (outcome) {
    case "ok":
      return "#3ddc97";
    case "error":
      return "#ff6b6b";
    case "start":
    default:
      return "#7cc4ff";
  }
}

/** useSyncExternalStore-friendly wrapper around `debugStore`. The
 *  store's `getSnapshot` is referentially stable between updates, so
 *  this hook only re-renders when the store actually changes. */
function useDebugStore(): DebugStoreState {
  return useSyncExternalStore(
    debugStore.subscribe,
    debugStore.getSnapshot,
    debugStore.getSnapshot,
  );
}

/** Try to write `text` to the clipboard. iOS Safari blocks
 *  programmatic clipboard writes outside a user gesture, so this
 *  also returns whether the write succeeded — callers fall back to
 *  a textarea-modal when it returns false. */
async function tryClipboardWrite(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Build a Blob URL and trigger a download. Returns the URL — caller
 *  should revoke it after the click. */
function downloadTextFile(name: string, text: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the click a moment to enqueue the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Dump builders (per-tab) ────────────────────────────────────────

function buildConsoleDump(
  logs: readonly DebugLogRecord[],
  filter: string,
): string {
  const lines = logs.map(
    (l) =>
      `[${formatTimestamp(l.timestamp)}] [${l.level}] [${l.source}] ${l.message}`,
  );
  if (!filter) return lines.join("\n");
  return [
    `# filter: ${JSON.stringify(filter)} (${lines.length} of ${logs.length} entries)`,
    ...lines,
  ].join("\n");
}

function buildTimelineDump(events: readonly DebugBootEvent[]): string {
  return events
    .map((e, idx) => {
      const prev = idx > 0 ? events[idx - 1] : null;
      const delta = prev ? `+${e.timestamp - prev.timestamp}ms` : "+0ms";
      const msg = e.message ? `\n    ${e.message}` : "";
      return `${formatTimestamp(e.timestamp)} [${e.outcome}] ${e.phase} (${delta})${msg}`;
    })
    .join("\n");
}

function buildFullSnapshotDump(state: DebugStoreState): string {
  return JSON.stringify(state, null, 2);
}

// ── Dump modal (iOS fallback) ──────────────────────────────────────

interface DumpModalState {
  title: string;
  body: string;
  fileName: string;
}

function DumpModal({
  state,
  onClose,
}: {
  state: DumpModalState;
  onClose: () => void;
}): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Auto-select on mount so the user can long-press → copy on iOS
  // without an extra tap. `setTimeout` to wait for the modal to
  // paint (otherwise the focus is lost when the textarea is
  // scrolled into view by the system).
  useEffect(() => {
    const id = setTimeout(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus({ preventScroll: true });
        el.select();
      }
    }, 50);
    return () => clearTimeout(id);
  }, []);
  return (
    <div
      data-testid="debug-dump-modal"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1_000_000,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(90vw, 720px)",
          maxHeight: "85vh",
          background: "#0a0e1a",
          color: "#e6edf3",
          border: "1px solid #2a3142",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "#131825",
            borderBottom: "1px solid #2a3142",
          }}
        >
          <strong style={{ flex: 1, fontSize: 12 }}>{state.title}</strong>
          <button
            type="button"
            onClick={() => downloadTextFile(state.fileName, state.body)}
            style={tabButtonStyle}
            title="Download as a .log / .json file"
          >
            download
          </button>
          <button
            type="button"
            onClick={async () => {
              const ok = await tryClipboardWrite(state.body);
              if (!ok) {
                // Clipboard API blocked (iOS without user gesture);
                // the textarea is already selected so the user can
                // long-press → copy.
                textareaRef.current?.focus();
                textareaRef.current?.select();
              }
            }}
            style={tabButtonStyle}
          >
            copy
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid #2a3142",
              color: "#e6edf3",
              borderRadius: 4,
              padding: "0 6px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              lineHeight: "16px",
            }}
          >
            ×
          </button>
        </div>
        <textarea
          ref={textareaRef}
          readOnly
          value={state.body}
          onFocus={(event) => event.currentTarget.select()}
          onClick={(event) => event.currentTarget.select()}
          spellCheck={false}
          style={{
            flex: 1,
            minHeight: 320,
            background: "#0a0e1a",
            color: "#e6edf3",
            border: "none",
            outline: "none",
            padding: "8px 10px",
            resize: "none",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            lineHeight: 1.4,
            whiteSpace: "pre",
            tabSize: 2,
          }}
        />
        <div
          style={{
            padding: "6px 10px",
            color: "#5b6573",
            fontSize: 10,
            borderTop: "1px solid #2a3142",
          }}
        >
          long-press → Select All → Copy on iOS, or use the buttons above
        </div>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────

export interface DebugPanelProps {
  /**
   * If `true`, the panel is initially open. Default `false` — the
   * toolbox button is the entry point.
   */
  defaultOpen?: boolean;
  /**
   * Initial filter for the console tab. Useful when the panel is
   * re-opened: the user expects their last filter to stick.
   */
  initialFilter?: string;
}

type Tab = "console" | "timeline" | "host" | "actions";

export function DebugPanel(props: DebugPanelProps = {}): React.ReactElement {
  const { defaultOpen = false, initialFilter = "" } = props;
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<Tab>("console");
  const [filter, setFilter] = useState(initialFilter);
  const [autoScroll, setAutoScroll] = useState(true);
  const [position, setPosition] = useState(PANEL_DEFAULT_POSITION);
  const [size, setSize] = useState<{ width: number; height: number }>(PANEL_DEFAULT_SIZE);
  /**
   * When the user taps the maximize button, we save the current size
   * + position so the second tap can restore the pre-maximize
   * geometry. `null` means "no restore geometry saved" — the
   * maximize button just fills the viewport without a restore
   * affordance on the next tap.
   */
  const [preMaximizeGeometry, setPreMaximizeGeometry] = useState<PersistedGeometry | null>(null);
  const [dumpModal, setDumpModal] = useState<DumpModalState | null>(null);

  // Hydrate position + size from localStorage on first mount. The
  // hook runs once and only acts on the initial values; the user's
  // subsequent moves are persisted via the useEffect below.
  useEffect(() => {
    const stored = loadGeometry();
    if (stored) {
      const { width, height } = clampedSize(stored.width, stored.height);
      setPosition(clampedPosition(stored.right, stored.bottom, width, height));
      setSize({ width, height });
    }
  }, []);

  // Persist position + size on change. Mount-time hydration skips
  // the write (the initial render would clobber any concurrent
  // update from another tab) — a single ref guards against the
  // first run.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    saveGeometry({ right: position.right, bottom: position.bottom, ...size });
  }, [position, size]);

  // Install the global capture as soon as the panel mounts. Idempotent.
  useEffect(() => {
    installConsoleCapture();
  }, []);

  // Stream the host-wallet snapshot into the store so the Host tab
  // can render it without depending on wallet init ownership.
  // Note: `wallet` is the snapshot object from `useHostWalletSnapshot`;
  // we destructure the fields we care about so the effect only re-runs
  // when one of THOSE changes, not on every wallet re-render.
  const wallet = useHostWalletSnapshot();
  const walletKind = wallet.state.kind;
  const walletPhase = wallet.state.kind === "resolving" || wallet.state.kind === "error" ? wallet.state.phase : undefined;
  const walletAddress = wallet.address;
  const walletError = wallet.state.kind === "error" ? wallet.state.reason : undefined;
  const walletReady = wallet.isReady;
  const walletInit = wallet.isInitializing;
  const walletOutside = wallet.isOutsideHost;
  // Wallet store no longer tracks allowances; the debug field is kept for
  // schema compat but always reports 0. Apps that drive `claimResourceAllowances`
  // directly can wire their own visibility if they care.
  const walletAllowanceCount = 0;
  useEffect(() => {
    debugStore.setHostSnapshot({
      stateKind: walletKind,
      phase: walletPhase,
      address: walletAddress ?? undefined,
      errorReason: walletError ?? undefined,
      isReady: walletReady,
      isInitializing: walletInit,
      isOutsideHost: walletOutside,
      allowanceCount: walletAllowanceCount,
      environment: detectHostEnvironment(),
      updatedAt: Date.now(),
    });
  }, [
    walletKind,
    walletPhase,
    walletAddress,
    walletError,
    walletReady,
    walletInit,
    walletOutside,
    walletAllowanceCount,
  ]);

  const state = useDebugStore();
  const filteredLogs = useMemo(() => {
    if (!filter) return state.logs;
    const needle = filter.toLowerCase();
    return state.logs.filter((l) => l.message.toLowerCase().includes(needle));
  }, [state.logs, filter]);

  // Auto-scroll the console tab to the bottom on new entries.
  const consoleRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!autoScroll || tab !== "console") return;
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filteredLogs.length, autoScroll, tab]);

  // Drag handling — the header is the drag handle.
  const dragRef = useRef<{ startX: number; startY: number; origRight: number; origBottom: number } | null>(null);
  const onHeaderPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const origRight = position.right;
      const origBottom = position.bottom;
      dragRef.current = { startX, startY, origRight, origBottom };
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
    },
    [position],
  );
  const onHeaderPointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    setPosition({
      right: Math.max(0, drag.origRight - dx),
      bottom: Math.max(0, drag.origBottom - dy),
    });
  }, []);
  const onHeaderPointerUp = useCallback((event: React.PointerEvent) => {
    dragRef.current = null;
    const target = event.currentTarget;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  }, []);

  // ── Resize handles ─────────────────────────────────────────────

  const resizeRef = useRef<ResizeState | null>(null);

  const onResizePointerDown = useCallback(
    (direction: ResizeDirection) => (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement;
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Some browsers (older Safari) reject setPointerCapture on
        // certain element types. Best-effort; the move handler still
        // runs on document-level pointermove via the global
        // listener below.
      }
      resizeRef.current = {
        direction,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: size.width,
        startHeight: size.height,
        startRight: position.right,
        startBottom: position.bottom,
      };
    },
    [size, position],
  );

  // Resize on pointermove. We listen on `window` (not the handle
  // element) so a finger that drags off the handle — common on
  // mobile when the corner handle is small relative to the thumb —
  // still tracks the resize. The pointer was captured on the
  // handle, so this listener reliably sees the events.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = event.clientX - r.startX;
      const dy = event.clientY - r.startY;
      let newWidth = r.startWidth;
      let newHeight = r.startHeight;
      let newRight = r.startRight;
      let newBottom = r.startBottom;
      // Each direction contributes independently. The math is in
      // viewport coords: right/bottom are offsets from the right /
      // bottom edges; dragging an edge in the "+" direction (away
      // from origin) increases the panel's dimensions and shifts
      // the offset inversely.
      if (r.direction.includes("e")) {
        newWidth = r.startWidth + dx;
        newRight = r.startRight - dx;
      }
      if (r.direction.includes("s")) {
        newHeight = r.startHeight + dy;
        newBottom = r.startBottom - dy;
      }
      if (r.direction.includes("w")) {
        // Left edge moves; the right edge stays put. The width
        // changes inversely with dx. The right offset doesn't move.
        newWidth = r.startWidth - dx;
      }
      if (r.direction.includes("n")) {
        // Top edge moves; the bottom edge stays put. Height shrinks
        // as the user drags down. The bottom offset doesn't move.
        newHeight = r.startHeight - dy;
      }
      const { width, height } = clampedSize(newWidth, newHeight);
      const { right, bottom } = clampedPosition(newRight, newBottom, width, height);
      setSize({ width, height });
      setPosition({ right, bottom });
    };
    const onUp = () => {
      if (resizeRef.current) resizeRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  // ── Maximize / restore ────────────────────────────────────────

  const isMaximized = preMaximizeGeometry !== null;

  const handleMaximizeToggle = useCallback(() => {
    if (isMaximized) {
      // Restore the pre-maximize geometry. The localStorage
      // persistence will then save the restored state on the next
      // effect run.
      setPosition(
        clampedPosition(
          preMaximizeGeometry.right,
          preMaximizeGeometry.bottom,
          preMaximizeGeometry.width,
          preMaximizeGeometry.height,
        ),
      );
      setSize({
        width: preMaximizeGeometry.width,
        height: preMaximizeGeometry.height,
      });
      setPreMaximizeGeometry(null);
    } else {
      // Save the current geometry then fill the viewport with a
      // margin on each side. The `clampedSize` helper picks the
      // exact size based on the current viewport dimensions.
      setPreMaximizeGeometry({
        right: position.right,
        bottom: position.bottom,
        width: size.width,
        height: size.height,
      });
      const target = clampedSize(
        typeof window !== "undefined" ? window.innerWidth : 1200,
        typeof window !== "undefined" ? window.innerHeight : 800,
      );
      setSize(target);
      setPosition({ right: VIEWPORT_MARGIN, bottom: VIEWPORT_MARGIN });
    }
  }, [isMaximized, preMaximizeGeometry, position, size]);

  // ── Copy / dump actions (per-tab + global) ─────────────────────

  const copyFilteredLogs = useCallback(async () => {
    const body = buildConsoleDump(filteredLogs, filter);
    const ok = await tryClipboardWrite(body);
    if (!ok) {
      setDumpModal({
        title: filter
          ? `Console — filter ${JSON.stringify(filter)} (${filteredLogs.length}/${state.logs.length})`
          : `Console — all (${state.logs.length})`,
        body,
        fileName: `console-${Date.now()}.log`,
      });
    }
  }, [filteredLogs, filter, state.logs.length]);

  const copyAllLogs = useCallback(async () => {
    const body = buildConsoleDump(state.logs, "");
    const ok = await tryClipboardWrite(body);
    if (!ok) {
      setDumpModal({
        title: `Console — all (${state.logs.length})`,
        body,
        fileName: `console-all-${Date.now()}.log`,
      });
    }
  }, [state.logs]);

  const openConsoleDump = useCallback(() => {
    setDumpModal({
      title: `Console dump (${state.logs.length} entries)`,
      body: buildConsoleDump(state.logs, ""),
      fileName: `console-all-${Date.now()}.log`,
    });
  }, [state.logs]);

  const copyTimeline = useCallback(async () => {
    const body = buildTimelineDump(state.bootEvents);
    const ok = await tryClipboardWrite(body);
    if (!ok) {
      setDumpModal({
        title: `Timeline (${state.bootEvents.length} events)`,
        body,
        fileName: `timeline-${Date.now()}.log`,
      });
    }
  }, [state.bootEvents]);

  const openTimelineDump = useCallback(() => {
    setDumpModal({
      title: `Timeline dump (${state.bootEvents.length} events)`,
      body: buildTimelineDump(state.bootEvents),
      fileName: `timeline-${Date.now()}.log`,
    });
  }, [state.bootEvents]);

  const copySnapshot = useCallback(async () => {
    const body = buildFullSnapshotDump(state);
    const ok = await tryClipboardWrite(body);
    if (!ok) {
      setDumpModal({
        title: "Host snapshot (JSON)",
        body,
        fileName: `snapshot-${Date.now()}.json`,
      });
    }
  }, [state]);

  const openSnapshotDump = useCallback(() => {
    setDumpModal({
      title: "Host snapshot (JSON)",
      body: buildFullSnapshotDump(state),
      fileName: `snapshot-${Date.now()}.json`,
    });
  }, [state]);

  const clearAll = useCallback(() => {
    debugStore.clearLogs();
    debugStore.clearBootEvents();
  }, []);

  const handleRetry = useCallback(() => {
    void retryHostWallet();
  }, []);

  const handleReset = useCallback(() => {
    __resetHostWalletForTests();
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open host-debug panel"
        data-testid="debug-panel-toggle"
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          width: 44,
          height: 44,
          borderRadius: 22,
          border: "1px solid #2a3142",
          background: "#0a0e1a",
          color: "#e6edf3",
          fontSize: 18,
          cursor: "pointer",
          zIndex: 999999,
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        🐞
      </button>
    );
  }

  return (
    <>
      <div
        data-testid="debug-panel"
        style={{
          position: "fixed",
          right: position.right,
          bottom: position.bottom,
          width: size.width,
          height: size.height,
          background: "#0a0e1a",
          color: "#e6edf3",
          border: "1px solid #2a3142",
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          zIndex: 999999,
        }}
      >
        <div
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            background: "#131825",
            borderBottom: "1px solid #2a3142",
            cursor: "grab",
            userSelect: "none",
            touchAction: "none",
            // The corner handles overlap the header at the top-left /
            // top-right; the handles sit at z-index 1 to win over the
            // header's drag handler for clicks in the corner hit
            // area. The bulk of the header is still draggable.
            position: "relative",
          }}
        >
          <strong style={{ flex: 1, fontSize: 12, color: "#e6edf3" }}>
            Host Debug
          </strong>
          <span
            title="Capture installed"
            style={{
              fontSize: 10,
              color: state.installed ? "#3ddc97" : "#9aa5b1",
              border: "1px solid #2a3142",
              borderRadius: 4,
              padding: "1px 5px",
            }}
          >
            {state.installed ? "CAPTURE" : "NO CAPTURE"}
          </span>
          <button
            type="button"
            onClick={handleMaximizeToggle}
            title={isMaximized ? "Restore previous size" : "Maximize to fill the viewport"}
            data-testid="debug-maximize"
            style={{
              background: "transparent",
              border: "1px solid #2a3142",
              color: "#e6edf3",
              borderRadius: 4,
              padding: "0 6px",
              cursor: "pointer",
              lineHeight: "16px",
              fontFamily: "inherit",
              fontSize: 12,
            }}
          >
            {isMaximized ? "❐" : "□"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            title="Close (toolbox button re-opens)"
            style={{
              background: "transparent",
              border: "1px solid #2a3142",
              color: "#e6edf3",
              borderRadius: 4,
              padding: "0 6px",
              cursor: "pointer",
              lineHeight: "16px",
              fontFamily: "inherit",
              fontSize: 12,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: "4px 6px",
            background: "#0e1320",
            borderBottom: "1px solid #2a3142",
          }}
        >
          {(["console", "timeline", "host", "actions"] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTab(t)}
              data-testid={`debug-tab-${t}`}
              style={{
                background: tab === t ? "#1b2235" : "transparent",
                color: tab === t ? "#e6edf3" : "#9aa5b1",
                border: "1px solid #2a3142",
                borderRadius: 4,
                padding: "2px 8px",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 11,
              }}
            >
              {t}
              {t === "console" && state.logs.length > 0 ? ` (${state.logs.length})` : ""}
              {t === "timeline" && state.bootEvents.length > 0 ? ` (${state.bootEvents.length})` : ""}
            </button>
          ))}
        </div>
        {tab === "console" ? (
          <ConsoleTab
            state={state}
            filter={filter}
            setFilter={setFilter}
            filteredLogs={filteredLogs}
            autoScroll={autoScroll}
            setAutoScroll={setAutoScroll}
            consoleRef={consoleRef}
            copyFilteredLogs={copyFilteredLogs}
            copyAllLogs={copyAllLogs}
            openDump={openConsoleDump}
            clearAll={clearAll}
          />
        ) : null}
        {tab === "timeline" ? (
          <TimelineTab
            state={state}
            copyTimeline={copyTimeline}
            openDump={openTimelineDump}
          />
        ) : null}
        {tab === "host" ? (
          <HostTab
            state={state}
            copySnapshot={copySnapshot}
            openDump={openSnapshotDump}
          />
        ) : null}
        {tab === "actions" ? (
          <ActionsTab
            onRetry={handleRetry}
            onReset={handleReset}
            onClear={clearAll}
            onCopySnapshot={copySnapshot}
            onOpenSnapshotDump={openSnapshotDump}
          />
        ) : null}
      </div>
      {/* Resize handles — 4 corners + 4 edges. Sibling divs at z-index 1
          so they sit ABOVE the panel content (including the header) and
          receive pointer events first. `touchAction: "none"` on each
          handle is critical for mobile — without it a touch-drag from
          a corner would scroll the page instead of resizing. The
          handles are visually subtle (a 1px corner dot) but the hit
          area is large (20px corners, 8px edges) for touch. */}
      <ResizeHandle direction="nw" onDown={onResizePointerDown} />
      <ResizeHandle direction="n" onDown={onResizePointerDown} />
      <ResizeHandle direction="ne" onDown={onResizePointerDown} />
      <ResizeHandle direction="w" onDown={onResizePointerDown} />
      <ResizeHandle direction="e" onDown={onResizePointerDown} />
      <ResizeHandle direction="sw" onDown={onResizePointerDown} />
      <ResizeHandle direction="s" onDown={onResizePointerDown} />
      <ResizeHandle direction="se" onDown={onResizePointerDown} />
      {dumpModal ? <DumpModal state={dumpModal} onClose={() => setDumpModal(null)} /> : null}
    </>
  );
}

// ── Resize handle (one per direction) ─────────────────────────────

const RESIZE_HANDLE_STYLES: Record<ResizeDirection, React.CSSProperties> = {
  // Edges — 8px thick strips. Invisible (no background, no border)
  // until the user hovers; the cursor + touchAction carry the
  // discoverability. We deliberately leave them invisible at rest
  // because the corners below are the primary affordance and a
  // full edge highlight would dominate the panel chrome.
  n: { top: 0, left: 12, right: 12, height: 8, cursor: "ns-resize" },
  s: { bottom: 0, left: 12, right: 12, height: 8, cursor: "ns-resize" },
  e: { top: 12, bottom: 12, right: 0, width: 8, cursor: "ew-resize" },
  w: { top: 12, bottom: 12, left: 0, width: 8, cursor: "ew-resize" },
  // Corners — 20x20 (mobile-friendly thumb target) with a 1px dot
  // so the user can see the affordance. Sits at the visual corner
  // of the panel (inset by 0).
  nw: { top: 0, left: 0, width: 20, height: 20, cursor: "nwse-resize" },
  ne: { top: 0, right: 0, width: 20, height: 20, cursor: "nesw-resize" },
  sw: { bottom: 0, left: 0, width: 20, height: 20, cursor: "nesw-resize" },
  se: { bottom: 0, right: 0, width: 20, height: 20, cursor: "nwse-resize" },
};

const RESIZE_HANDLE_INNER: Record<ResizeDirection, React.CSSProperties> = {
  // Only the corner handles get a visible dot. The edge handles
  // are pure hit targets.
  nw: { top: 1, left: 1 },
  ne: { top: 1, right: 1 },
  sw: { bottom: 1, left: 1 },
  se: { bottom: 1, right: 1 },
  n: {},
  s: {},
  e: {},
  w: {},
};

function ResizeHandle({
  direction,
  onDown,
}: {
  direction: ResizeDirection;
  onDown: (direction: ResizeDirection) => (event: React.PointerEvent) => void;
}): React.ReactElement {
  const isCorner = direction.length === 2;
  return (
    <div
      data-testid={`debug-resize-${direction}`}
      onPointerDown={onDown(direction)}
      // `touchAction: "none"` is the critical mobile detail: it
      // suppresses the browser's default touch-scroll behaviour so
      // a drag from a corner handle actually resizes the panel.
      // Without this, the user's finger on the se corner would
      // scroll the page underneath and the resize would never
      // start.
      style={{
        position: "absolute",
        zIndex: 1,
        touchAction: "none",
        userSelect: "none",
        ...RESIZE_HANDLE_STYLES[direction],
      }}
    >
      {isCorner ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            width: 6,
            height: 6,
            background: "#5b6573",
            borderRadius: 1,
            ...RESIZE_HANDLE_INNER[direction],
          }}
        />
      ) : null}
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────────────

interface ConsoleTabProps {
  state: DebugStoreState;
  filter: string;
  setFilter: (v: string) => void;
  filteredLogs: readonly DebugLogRecord[];
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  consoleRef: React.MutableRefObject<HTMLDivElement | null>;
  copyFilteredLogs: () => void;
  copyAllLogs: () => void;
  openDump: () => void;
  clearAll: () => void;
}

function ConsoleTab(props: ConsoleTabProps): React.ReactElement {
  const {
    state,
    filter,
    setFilter,
    filteredLogs,
    autoScroll,
    setAutoScroll,
    consoleRef,
    copyFilteredLogs,
    copyAllLogs,
    openDump,
    clearAll,
  } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "4px 6px",
          background: "#0e1320",
          borderBottom: "1px solid #2a3142",
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          placeholder="filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: "1 1 100px",
            minWidth: 80,
            background: "#0a0e1a",
            color: "#e6edf3",
            border: "1px solid #2a3142",
            borderRadius: 4,
            padding: "2px 6px",
            fontFamily: "inherit",
            fontSize: 11,
          }}
        />
        <button
          type="button"
          onClick={copyFilteredLogs}
          style={tabButtonStyle}
          title={
            filter
              ? `Copy the ${filteredLogs.length} filtered lines (out of ${state.logs.length})`
              : `Copy all ${state.logs.length} lines`
          }
        >
          {filter ? `copy (${filteredLogs.length})` : "copy"}
        </button>
        <button
          type="button"
          onClick={copyAllLogs}
          style={tabButtonStyle}
          disabled={state.logs.length === 0}
          title={`Copy the entire ring buffer (${state.logs.length} lines)`}
        >
          copy all
        </button>
        <button
          type="button"
          onClick={openDump}
          style={tabButtonStyle}
          disabled={state.logs.length === 0}
          title="Open the entire log dump in a textarea modal — useful on iOS where clipboard access requires a long-press selection"
        >
          dump
        </button>
        <button
          type="button"
          onClick={clearAll}
          style={tabButtonStyle}
          title="Clear console buffer"
        >
          clear
        </button>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            color: "#9aa5b1",
            fontSize: 10,
            padding: "0 4px",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          tail
        </label>
      </div>
      <div
        ref={consoleRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 6px",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          lineHeight: 1.4,
        }}
      >
        {filteredLogs.length === 0 ? (
          <div style={{ color: "#9aa5b1", fontStyle: "italic" }}>
            {filter ? "no matches" : state.logs.length === 0 ? "no logs yet" : "filter excludes all entries"}
          </div>
        ) : (
          filteredLogs.map((l: DebugLogRecord) => (
            <div key={l.id} style={{ color: levelColor(l.level) }}>
              <span style={{ color: "#5b6573" }}>{formatTimestamp(l.timestamp)}</span>{" "}
              <span style={{ color: "#9aa5b1" }}>[{l.level}]</span>{" "}
              <span style={{ color: "#5b6573" }}>[{l.source}]</span> {l.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TimelineTab({
  state,
  copyTimeline,
  openDump,
}: {
  state: DebugStoreState;
  copyTimeline: () => void;
  openDump: () => void;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "4px 6px",
          background: "#0e1320",
          borderBottom: "1px solid #2a3142",
        }}
      >
        <button
          type="button"
          onClick={copyTimeline}
          style={tabButtonStyle}
          disabled={state.bootEvents.length === 0}
          title="Copy the timeline to the clipboard"
        >
          copy
        </button>
        <button
          type="button"
          onClick={openDump}
          style={tabButtonStyle}
          disabled={state.bootEvents.length === 0}
          title="Open the timeline dump in a textarea modal"
        >
          dump
        </button>
      </div>
      {state.bootEvents.length === 0 ? (
        <div
          style={{
            flex: 1,
            padding: 12,
            color: "#9aa5b1",
            fontStyle: "italic",
          }}
        >
          no boot events recorded. The wallet store records events as
          `initInternal` walks the phases (handshake → inject-extension →
          get-product-account → build-signer → claim-allowances → ready).
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "6px 8px",
            lineHeight: 1.5,
          }}
        >
          {state.bootEvents.map((e: DebugBootEvent, idx: number) => {
            const prev = idx > 0 ? state.bootEvents[idx - 1] : null;
            const delta = prev ? `+${e.timestamp - prev.timestamp}ms` : "+0ms";
            return (
              <div key={e.id} style={{ marginBottom: 2 }}>
                <span style={{ color: "#5b6573" }}>{formatTimestamp(e.timestamp)}</span>{" "}
                <span style={{ color: outcomeColor(e.outcome) }}>[{e.outcome}]</span>{" "}
                <span style={{ color: "#e6edf3" }}>{phaseLabel(e.phase)}</span>{" "}
                <span style={{ color: "#5b6573" }}>({delta})</span>
                {e.message ? (
                  <div style={{ color: "#9aa5b1", paddingLeft: 12 }}>{e.message}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HostTab({
  state,
  copySnapshot,
  openDump,
}: {
  state: DebugStoreState;
  copySnapshot: () => void;
  openDump: () => void;
}): React.ReactElement {
  const host = state.hostSnapshot;
  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "8px 10px",
        lineHeight: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {host ? (
        <>
          <Field label="state" value={host.stateKind} />
          <Field label="environment" value={host.environment} />
          <Field label="phase" value={host.phase ?? "—"} />
          <Field label="address" value={host.address ?? "—"} />
          <Field label="error" value={host.errorReason ?? "—"} />
          <Field label="isReady" value={String(host.isReady)} />
          <Field label="isInitializing" value={String(host.isInitializing)} />
          <Field label="isOutsideHost" value={String(host.isOutsideHost)} />
          <Field label="allowances" value={String(host.allowanceCount)} />
          <Field label="updatedAt" value={formatTimestamp(host.updatedAt)} />
          <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
            <button type="button" onClick={copySnapshot} style={tabButtonStyle}>
              copy JSON
            </button>
            <button type="button" onClick={openDump} style={tabButtonStyle}>
              dump
            </button>
          </div>
        </>
      ) : (
        <div style={{ color: "#9aa5b1", fontStyle: "italic" }}>
          no host state yet. The wallet store starts populating the
          snapshot on first mount.
        </div>
      )}
    </div>
  );
}

function ActionsTab({
  onRetry,
  onReset,
  onClear,
  onCopySnapshot,
  onOpenSnapshotDump,
}: {
  onRetry: () => void;
  onReset: () => void;
  onClear: () => void;
  onCopySnapshot: () => void;
  onOpenSnapshotDump: () => void;
}): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        overflowY: "auto",
      }}
    >
      <ActionButton
        label="retry host init"
        description="Re-runs connectToHost → injectHostWallet → getProductAccount → signers → claimAllowances"
        onClick={onRetry}
      />
      <ActionButton
        label="reset wallet store"
        description="Drops the singleton state so the next mount starts fresh. Use to recover from a wedged host connection."
        onClick={onReset}
      />
      <ActionButton
        label="clear logs + timeline"
        description="Empties the ring buffers. Useful when investigating a specific phase transition."
        onClick={onClear}
      />
      <div style={{ display: "flex", gap: 4 }}>
        <button type="button" onClick={onCopySnapshot} style={{ ...tabButtonStyle, flex: 1 }}>
          copy full snapshot
        </button>
        <button type="button" onClick={onOpenSnapshotDump} style={{ ...tabButtonStyle, flex: 1 }}>
          open dump
        </button>
      </div>
      <div style={{ color: "#5b6573", fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
        Drag the panel header to reposition. The toolbox button (bottom-right) re-opens
        it after closing. The capture is module-level — it stays installed across
        panel open/close. The "copy" buttons write to the system clipboard; on iOS
        Safari a long-press the textarea in the dump modal is the fallback path.
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ color: "#9aa5b1", width: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "#e6edf3", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function ActionButton({
  label,
  description,
  onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "#131825",
        color: "#e6edf3",
        border: "1px solid #2a3142",
        borderRadius: 4,
        padding: "6px 10px",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 12,
      }}
    >
      <div>{label}</div>
      <div style={{ color: "#9aa5b1", fontSize: 11, marginTop: 2 }}>{description}</div>
    </button>
  );
}

const tabButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#9aa5b1",
  border: "1px solid #2a3142",
  borderRadius: 4,
  padding: "2px 8px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11,
};

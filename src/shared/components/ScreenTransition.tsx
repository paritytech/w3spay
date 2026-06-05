/**
 * Crossfade two screens whenever `transitionKey` changes.
 *
 * On a key change the existing screen ("leaving") stays mounted for one
 * animation cycle, absolutely positioned above the workspace so it
 * doesn't push the new screen ("entering") down while both are visible.
 * Both run their CSS animation in parallel — the leaving slot fades out
 * with a small upward translate, the entering slot fades in with a
 * small upward translate. Net effect: a brief crossfade that matches
 * the editorial vocabulary already used elsewhere (`w3-screen-in`).
 *
 * Keeping the previous slot mounted during the transition has one
 * intentional consequence: components with long-running side effects
 * (the `<Scanner>`'s camera, for instance) stay live until the leaving
 * slot is unmounted. That's the right behaviour — the user is already
 * looking at the new screen by the time the camera shuts down.
 *
 * ## Implementation note — leave-slot key must match the old enter-slot key
 *
 * The leaving slot uses `key={`enter:${leaving.key}`}` — the *same* key
 * the old enter slot had. React's reconciler therefore *reuses* the
 * existing DOM element in-place rather than unmounting/remounting it.
 * Only the `className` and `aria-hidden` attributes change; the subtree
 * (including live `<video>`) is kept intact. Without this, React would
 * unmount the live scanner (stopping the camera mid-animation) and
 * remount a fresh one whose ghost-guard correctly refuses to re-open the
 * camera — so the leaving slot would flash a spinner instead of the live
 * viewfinder for the 240 ms exit window.
 *
 * ## Implementation note — why we update state during render
 *
 * The previous implementation used `useEffect` to detect key changes,
 * which fires *after* the browser has already painted. This caused a
 * one-frame flash: for the first paint after navigation the new
 * `transitionKey` was live but the transition state hadn't updated yet,
 * so the old page was shown without animation before the crossfade
 * started.
 *
 * The fix is React's "store information from previous renders" pattern:
 * call `setState` directly during render when the key changes. React
 * immediately throws away the current render and re-renders with the new
 * state, so the browser only ever paints the final crossfade layout.
 * A `useLayoutEffect` (runs before paint, after commit) keeps the
 * previous-children ref fresh so rapid successive transitions capture
 * the correct leaving content.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const TRANSITION_MS = 280;

interface ScreenSlot {
  readonly key: string;
  readonly node: ReactNode;
}

interface ScreenTransitionState {
  readonly currentKey: string;
  readonly leaving: ScreenSlot | null;
}

export interface ScreenTransitionProps {
  /** Identifier whose change triggers a crossfade. */
  readonly transitionKey: string;
  readonly children: ReactNode;
}

export function ScreenTransition({ transitionKey, children }: ScreenTransitionProps) {
  // Snapshot of the previous render's children — used as the leaving slot's
  // content when the key changes. We don't store children in state (doing so
  // would cause infinite re-renders since JSX objects are never referentially
  // stable across renders). Instead we capture it via a layout effect that
  // runs before the browser paints, ensuring a rapid key change in the same
  // frame captures the correct previous content.
  const prevChildrenRef = useRef<ReactNode>(children);

  const [state, setState] = useState<ScreenTransitionState>({
    currentKey: transitionKey,
    leaving: null,
  });

  // Detect a key change *during* render — before any paint. React immediately
  // discards the current render output and re-renders with the new state, so
  // the browser never sees the intermediate frame where the new transitionKey
  // is live but the crossfade hasn't started yet.
  if (state.currentKey !== transitionKey) {
    setState({
      currentKey: transitionKey,
      leaving: { key: state.currentKey, node: prevChildrenRef.current },
    });
  }

  // Keep the snapshot current. Layout timing (before paint, after commit)
  // ensures it's up-to-date when the key-change detection above runs on
  // the very next render, capturing the last-painted page's children.
  useLayoutEffect(() => {
    prevChildrenRef.current = children;
  });

  // Drop the leaving slot after its exit animation completes.
  useEffect(() => {
    if (state.leaving == null) return;
    const id = window.setTimeout(() => {
      setState((prev) => (prev.leaving == null ? prev : { ...prev, leaving: null }));
    }, TRANSITION_MS);
    return () => window.clearTimeout(id);
  }, [state.leaving]);

  return (
    <>
      {state.leaving != null ? (
        <div
          key={`enter:${state.leaving.key}`}
          className="screen-transition screen-transition--leave"
          aria-hidden="true"
        >
          {state.leaving.node}
        </div>
      ) : null}
      <div
        key={`enter:${transitionKey}`}
        className="screen-transition screen-transition--enter"
      >
        {children}
      </div>
    </>
  );
}

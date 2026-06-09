// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Crossfade two screens whenever `transitionKey` changes. The leaving screen
 * stays mounted for one animation cycle, absolutely positioned so it doesn't
 * shove the entering screen down.
 *
 * Gotcha: the leave slot's key MUST match the old enter slot's key
 * (`enter:${leaving.key}`) so React reuses the DOM in-place rather than
 * remounting — otherwise a live `<video>` (the Scanner camera) is torn down
 * and remounted mid-animation, flashing a spinner for the exit window.
 *
 * Key changes are detected during render (not in an effect) and committed via
 * setState-in-render, so the browser never paints the pre-crossfade frame.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const TRANSITION_MS = 200;

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
  // Snapshot of the previous render's children for the leaving slot. Not stored
  // in state — JSX objects are never referentially stable, so that would loop;
  // captured in a layout effect (before paint) so a same-frame key change sees it.
  const prevChildrenRef = useRef<ReactNode>(children);

  const [state, setState] = useState<ScreenTransitionState>({
    currentKey: transitionKey,
    leaving: null,
  });

  // Detect a key change during render — React discards this render and re-renders
  // with the new state, so the pre-crossfade frame (new key, no animation) never paints.
  if (state.currentKey !== transitionKey) {
    setState({
      currentKey: transitionKey,
      leaving: { key: state.currentKey, node: prevChildrenRef.current },
    });
  }

  // Layout timing (before paint, after commit) keeps the snapshot fresh for the
  // next render's key-change check.
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

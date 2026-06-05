/**
 * Guard that decides whether a scanner host element is a *live* surface
 * worth opening the camera for — or a transition ghost that should be
 * left alone.
 *
 * ## The problem this solves
 *
 * `<ScreenTransition>` keeps the *leaving* screen mounted for ~280 ms so
 * it can crossfade out (see `shared/components/ScreenTransition.tsx`).
 * The leaving slot is a freshly-mounted copy of the previous screen's
 * React tree under a new key, wrapped in `aria-hidden="true"`. When the
 * scan screen is the leaving content, that copy mounts a *second*
 * scanner whose effect fires and races the live (entering) scanner for
 * the single camera capture session.
 *
 * On iOS this is fatal: the camera releases asynchronously after
 * `track.stop()`, so the second `getUserMedia` lands while the first
 * stream is still settling and rejects with `NotReadableError`
 * ("Could not start video source"). The device log shows the symptom —
 * multiple "camera ready" events in the same second, some against a
 * ## The rule
 *
 * A host is live, and we should open the camera, only when it is:
 *   - **connected** to the document (not a detached node left over from
 *     an unmount whose async start resolved late — the `host:0×0` lines
 *     in the device log), and
 *   - **not inside an `aria-hidden="true"` subtree** (the marker
 *     `<ScreenTransition>` puts on the leaving slot — i.e. a decorative,
 *     fading-out ghost the user is no longer interacting with).
 *
 * We deliberately do NOT gate on the host's box size. A zero-size host is
 * only ever a layout bug, never the ghost-vs-live signal — and gating on
 * it is a footgun: if a WebView reports a transiently-collapsed-but-live
 * box (an `aspect-ratio` reflow timing quirk, say) the guard would
 * silently refuse to start the camera and hang the spinner. The decoders
 * don't need a sized host anyway: qr-scanner probes its own bounding
 * rect, and the WASM backend captures from the video's source dimensions,
 * not the rendered box.
 *
 * Skipping the camera for a ghost is invisible to the user — the ghost is
 * `aria-hidden`, pointer-events-none, and unmounts within the transition
 * window — and it collapses the "N scanners fight for one camera" race
 * down to the single live surface.
 */
export function isLiveScanHost(host: HTMLElement | null): host is HTMLElement {
  if (host == null) return false;
  if (!host.isConnected) return false;
  return host.closest('[aria-hidden="true"]') == null;
}

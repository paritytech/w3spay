/**
 * Minimal CSS-driven spinner. Sized to ride inline with body text, with
 * the loading label rendered in italic DM Serif Display to match the
 * editorial direction.
 */

export interface SpinnerProps {
  /** Spinner edge length in pixels. Defaults to `14`. */
  size?: number;
  /** Optional label rendered after the spinner (visible). */
  label?: string;
  /** Optional class hook for layout. */
  className?: string;
}

export function Spinner({ size = 14, label, className }: SpinnerProps) {
  const dimension = `${size}px`;
  return (
    <span
      className={className ? `spinner ${className}` : "spinner"}
      role="status"
      aria-live="polite"
    >
      <span
        className="spinner__ring"
        style={{ width: dimension, height: dimension }}
        aria-hidden="true"
      />
      {label === undefined ? null : <span className="spinner__label">{label}</span>}
    </span>
  );
}

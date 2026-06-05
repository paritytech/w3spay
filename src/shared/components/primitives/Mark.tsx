/**
 * W3sPay logo mark — concentric circles in the brand palette. Used wherever
 * the wordmark appears (Rail, Boot splash, scan top-bar).
 */

export interface MarkProps {
  size?: number;
  ring?: string;
  dot?: string;
}

export function Mark({ size = 22, ring = "var(--color-text-primary)", dot = "var(--color-bg)" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="28" fill={ring} />
      <circle cx="32" cy="32" r="9" fill={dot} />
    </svg>
  );
}

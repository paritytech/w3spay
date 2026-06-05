/**
 * Typed alias for the CSS-variable design palette.
 *
 * w3spay's class-based `styles.css` drives all visual styling — these
 * constants are the typed entrypoint for inline-style call sites (rare;
 * mostly the dynamic insets in `screens/info/*`) and any future TS-side
 * theme consumers. Mirrors `apps/w3spay-admin/src/ui/tokens.ts`.
 *
 * Updating a value here is purely cosmetic; the CSS source of truth is
 * `src/styles.css`. Keep names in sync so call sites that switch from
 * `style={{ color: tokens.textPrimary }}` to a className continue to
 * produce the same paint.
 */

export const tokens = {
  // Surfaces
  bg: "var(--color-bg)",
  bgSubtle: "var(--color-bg-subtle)",
  // Text
  textPrimary: "var(--color-text-primary)",
  textSecondary: "var(--color-text-secondary)",
  textTertiary: "var(--color-text-tertiary)",
  textMuted: "var(--color-text-muted)",
  textFaint: "var(--color-text-faint)",
  // Type
  fontSerif: "var(--font-serif)",
  fontMono: "var(--font-mono)",
} as const;

export type Tokens = typeof tokens;

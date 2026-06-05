/**
 * Tip selection — pure logic.
 *
 * The tip screen sits between the scanner and the confirm screen. The
 * customer either picks a percent preset (most paths) or types a custom
 * euro amount (rare). The chosen tip is added to the receipt subtotal
 * before `host.paymentRequest` is called.
 *
 * Everything in this module is expressed in **cents** to match the rest of
 * `pay/` — the TSE parser already normalises receipt amounts to integer
 * cents, and `formatAmountCents` is the single rendering boundary. Doing
 * the math here in EUR (floating point) would re-introduce the rounding
 * class of bugs the cent-based pipeline is designed to avoid.
 */

/**
 * Tip presets in percent. Order drives the chip grid order — mirrors the
 * four options on a typical credit-card payment terminal (7 / 10 / 15 / 0).
 * 0% comes last as the explicit "no tip" escape hatch rather than the
 * default suggestion.
 */
export const TIP_PRESETS: readonly number[] = [7, 10, 15, 0];

/** Default selection when the tip screen first opens. */
export const DEFAULT_TIP_PERCENT = 10;

/**
 * Sanity cap for custom tip input, in cents. 999_999 cents == €9,999.99.
 * The pilot scanner is a counter-top product; anything beyond this is
 * almost certainly a typo, and clamping keeps the rest of the math
 * bounded.
 */
export const MAX_CUSTOM_TIP_CENTS = 999_999;

/**
 * What the user selected on the tip screen. The screen carries both —
 * the active `kind` is what feeds `computeTipCents`; the inactive one is
 * remembered so the chip and the custom field can both light up
 * independently when the customer toggles between them.
 */
export type TipSelection =
  | { kind: "preset"; percent: number }
  | { kind: "custom"; cents: number };

/**
 * Resolve the tip amount in integer cents for a given subtotal.
 *
 * Preset rounds `subtotal * percent / 100` half-up to the nearest cent —
 * "10% of €2.55" lands on 26 cents (not 25), matching every Berlin
 * cashier's mental model. Custom passes through the parsed cents
 * directly, clamped to `[0, MAX_CUSTOM_TIP_CENTS]`.
 *
 * @throws TypeError if `subtotalCents` isn't a non-negative integer —
 *   the parser is the only producer of subtotals and always hands us
 *   integers; defending here prevents float drift from leaking in.
 */
export function computeTipCents(
  subtotalCents: number,
  selection: TipSelection,
): number {
  if (
    !Number.isFinite(subtotalCents) ||
    !Number.isInteger(subtotalCents) ||
    subtotalCents < 0
  ) {
    throw new TypeError(
      `computeTipCents expects a non-negative integer subtotal, got ${subtotalCents}`,
    );
  }
  if (selection.kind === "preset") {
    if (selection.percent <= 0) return 0;
    return Math.round((subtotalCents * selection.percent) / 100);
  }
  const c = selection.cents;
  if (!Number.isFinite(c) || c <= 0) return 0;
  return Math.min(MAX_CUSTOM_TIP_CENTS, Math.trunc(c));
}

/**
 * Parse a user-typed custom tip string into integer cents.
 *
 * Accepts both German (`1,50`) and dot (`1.50`) decimal separators, and
 * sub-euro shortforms (`.99`). Returns `null` for empty or unparseable
 * input — the caller treats `null` as "no tip yet" without locking the
 * Continue button.
 *
 * Parsed cents are clamped to `[0, MAX_CUSTOM_TIP_CENTS]`.
 */
export function parseCustomTipInput(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  // German locale: comma as decimal separator. Replace and accept either.
  const normalized = trimmed.replace(",", ".");
  // Strict: digits with at most one decimal point and at most 2 fractional digits.
  // Permits "1", "1.", "1.5", "1.50", ".5", ".50" — rejects "1.500", "1.2.3", "abc".
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(normalized)) return null;
  const asNumber = Number(normalized);
  if (!Number.isFinite(asNumber) || asNumber < 0) return null;
  const cents = Math.round(asNumber * 100);
  if (cents < 0) return null;
  return Math.min(MAX_CUSTOM_TIP_CENTS, cents);
}

/**
 * Whole-percent display ("12%") for a tip vs its subtotal. Returns 0 for
 * 0 tip without doing the division. Always rounds half-up so the chip's
 * displayed amount matches the percent label exactly when both come from
 * the same `(subtotal, percent)` pair.
 */
export function tipPercentLabel(subtotalCents: number, tipCents: number): number {
  if (tipCents <= 0 || subtotalCents <= 0) return 0;
  return Math.round((tipCents / subtotalCents) * 100);
}

/**
 * Sanitize a raw input value so it can only ever hold a parseable euro
 * amount string. Drops anything that isn't a digit or a decimal
 * separator, then collapses extra separators (`"1.5.5"` → `"1.55"`) and
 * caps the fractional part at two digits — keeping the visible input
 * in lock-step with `parseCustomTipInput`.
 *
 * Preserves whichever separator the customer typed first so the German
 * comma stays visible for users who entered it.
 */
export function sanitizeCustomTipInput(raw: string): string {
  let next = raw.replace(/[^0-9.,]/g, "");
  const sepIdx = next.search(/[.,]/);
  if (sepIdx >= 0) {
    const intPart = next.slice(0, sepIdx + 1);
    const fracPart = next.slice(sepIdx + 1).replace(/[.,]/g, "").slice(0, 2);
    next = intPart + fracPart;
  }
  return next;
}

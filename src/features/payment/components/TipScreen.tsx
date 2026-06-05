/**
 * Tip selection screen — editorial layout (variant B from the design).
 *
 * Sits between `ScanningScreen` and `ConfirmScreen` in the happy path.
 * The customer picks a percent preset (5/10/15/20% or 0%) or types a
 * custom euro amount, then taps Continue to commit. "Skip" advances
 * with `tipCents = 0` — equivalent to selecting the 0% preset, just
 * faster to reach.
 *
 * The screen owns its own UI state (selected preset, custom string).
 * It hands a resolved integer-cent tip back to the parent on Continue
 * / Skip; the parent threads that into `ConfirmScreen` and ultimately
 * into `host.paymentRequest`.
 */

import { useState } from "react";

import { formatAmountCents } from "@/shared/utils/format-amount.ts";
import {
  computeTipCents,
  DEFAULT_TIP_PERCENT,
  parseCustomTipInput,
  sanitizeCustomTipInput,
  TIP_PRESETS,
  tipPercentLabel,
  type TipSelection,
} from "@/features/payment/lib/tip.ts";
import {
  Dotted,
  Eyebrow,
  Frame,
  PrimaryButton,
  SecondaryButton,
  Step,
} from "@/shared/components/primitives.tsx";
import { ASSET_LABEL, splitDisplayName } from "@/shared/utils/format.ts";

export interface TipScreenProps {
  merchantDisplayName: string;
  /** Receipt subtotal in integer cents (TSE parser output). */
  subtotalCents: number;
  /**
   * Skip the tip step entirely. Equivalent to selecting 0% and
   * tapping Continue — the parent treats both calls the same way.
   */
  onSkip: () => void;
  /**
   * Commit the chosen tip in integer cents. `tipCents` is always
   * non-negative; the parent computes the total as
   * `subtotalCents + tipCents`.
   */
  onContinue: (tipCents: number) => void;
}

type Mode = "preset" | "custom";

export function TipScreen({
  merchantDisplayName,
  subtotalCents,
  onSkip,
  onContinue,
}: TipScreenProps) {
  const [mode, setMode] = useState<Mode>("preset");
  const [percent, setPercent] = useState<number>(DEFAULT_TIP_PERCENT);
  const [customStr, setCustomStr] = useState<string>("");

  const selection: TipSelection =
    mode === "preset"
      ? { kind: "preset", percent }
      : { kind: "custom", cents: parseCustomTipInput(customStr) ?? 0 };

  const tipCents = computeTipCents(subtotalCents, selection);
  const totalCents = subtotalCents + tipCents;
  const tipPercent = tipPercentLabel(subtotalCents, tipCents);

  const { name } = splitDisplayName(merchantDisplayName);

  const onPickPreset = (p: number) => {
    setMode("preset");
    setPercent(p);
  };

  const onPickOther = () => {
    setMode("custom");
  };

  const handleCustomChange = (raw: string) => {
    setCustomStr(sanitizeCustomTipInput(raw));
  };

  return (
    <Frame
      footer={
        <div className="btn-row">
          <SecondaryButton onClick={onSkip}>Skip</SecondaryButton>
          <PrimaryButton onClick={() => onContinue(tipCents)}>
            Continue · {formatAmountCents(totalCents)} {ASSET_LABEL}
          </PrimaryButton>
        </div>
      }
    >
      <Step n={2} of={3} label="Add a tip" />

      <div className="tip-head">
        <h1 className="editorial-head tip-head__line">
          For <span className="editorial-head__suffix">{name},</span>
        </h1>
        <h1 className="editorial-head tip-head__line">
          <span className="editorial-head__suffix">a little</span> extra?
        </h1>
      </div>

      <Dotted style={{ marginTop: 14, marginBottom: 4 }} />

      {/* Receipt subtotal line — small, mono on the right. */}
      <div className="tip-subtotal">
        <span className="tip-subtotal__label">Receipt subtotal</span>
        <span className="tip-subtotal__value">
          {formatAmountCents(subtotalCents)} {ASSET_LABEL}
        </span>
      </div>

      {/* Big total cluster — pure typography, no card. */}
      <div className="tip-total">
        <Eyebrow>Total with tip</Eyebrow>
        <div className="tip-total__amount">
          {formatAmountCents(totalCents)}
          <span className="tip-total__ticker">{ASSET_LABEL}</span>
        </div>
        <p className={tipCents > 0 ? "tip-total__line" : "tip-total__line tip-total__line--empty"}>
          {tipCents > 0 ? (
            <>
              Tip {formatAmountCents(tipCents)} {ASSET_LABEL}
              <span className="tip-total__line-pct"> · {tipPercent}%</span>
            </>
          ) : (
            "No tip added."
          )}
        </p>
      </div>

      <Dotted style={{ marginTop: 4, marginBottom: 14 }} />

      {/* Preset grid — 4 percent chips above, full-width "Other" below. */}
      <div className="tip-presets" role="radiogroup" aria-label="Tip presets">
        {TIP_PRESETS.map((p) => {
          const active = mode === "preset" && percent === p;
          const presetTipCents = computeTipCents(subtotalCents, { kind: "preset", percent: p });
          return (
            <TipPresetChip
              key={p}
              active={active}
              onClick={() => onPickPreset(p)}
              percent={p}
              tipCents={presetTipCents}
            />
          );
        })}
        <TipPresetChip other active={mode === "custom"} onClick={onPickOther} />
      </div>

      {/* Custom input — only when the user picked "Other". */}
      {mode === "custom" && (
        <div className="tip-custom">
          <Eyebrow>Custom tip · {ASSET_LABEL}</Eyebrow>
          <div className="tip-custom__input-row">
            <span className="tip-custom__symbol">€</span>
            <input
              autoFocus
              inputMode="decimal"
              value={customStr}
              onChange={(e) => handleCustomChange(e.target.value)}
              placeholder="0.00"
              aria-label="Custom tip amount in euros"
              className="tip-custom__input"
            />
          </div>
          <p className="tip-custom__hint">Enter a euro amount.</p>
        </div>
      )}
    </Frame>
  );
}

interface TipPresetChipProps {
  active: boolean;
  onClick: () => void;
  percent?: number;
  tipCents?: number;
  other?: boolean;
}

function TipPresetChip({ active, onClick, percent, tipCents, other }: TipPresetChipProps) {
  const cls = active
    ? "tip-preset tip-preset--active"
    : "tip-preset";

  if (other) {
    const otherCls = active
      ? "tip-preset tip-preset--other tip-preset--active"
      : "tip-preset tip-preset--other";
    return (
      <button
        type="button"
        className={otherCls}
        onClick={onClick}
        role="radio"
        aria-checked={active}
        aria-label="Custom tip amount"
      >
        <span className="tip-preset__primary tip-preset__primary--other">Other</span>
        <span className="tip-preset__caption">Custom €</span>
      </button>
    );
  }

  const pct = percent ?? 0;
  const cents = tipCents ?? 0;
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      role="radio"
      aria-checked={active}
      aria-label={`${pct} percent tip`}
    >
      <span className="tip-preset__primary">
        {pct}
        <span className="tip-preset__primary-suffix">%</span>
      </span>
      <span className="tip-preset__caption">
        {pct === 0 ? "—" : formatAmountCents(cents)}
      </span>
    </button>
  );
}

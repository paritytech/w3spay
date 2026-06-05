/**
 * Step counter — Roman numeral (`I / III`) + uppercase label. Used by
 * the multi-step flow screens (Tip → Confirm → Done).
 */

const ROMAN = ["", "I", "II", "III", "IV"] as const;

export interface StepProps {
  n: 1 | 2 | 3 | 4;
  of?: 1 | 2 | 3 | 4;
  label: string;
}

export function Step({ n, of = 2, label }: StepProps) {
  return (
    <div className="editorial-step">
      <span className="editorial-step__numeral">
        {ROMAN[n]}
        <span className="editorial-step__numeral-of"> / {ROMAN[of]}</span>
      </span>
      <span className="editorial-step__label">{label}</span>
    </div>
  );
}

/**
 * MetaRow — `<dt> / <dd>` pair rendered as the structured-fact line at
 * the bottom of pay/done/receipt screens. `mono` renders the value in
 * the monospace font (paymentId, amounts).
 */

import type { ReactNode } from "react";

export interface MetaRowProps {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

export function MetaRow({ label, value, mono }: MetaRowProps) {
  const valueClass = mono ? "meta-row__value meta-row__value--mono" : "meta-row__value";
  return (
    <div className="meta-row">
      <dt className="meta-row__label">{label}</dt>
      <dd className={valueClass}>{value}</dd>
    </div>
  );
}

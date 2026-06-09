// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Editorial Frame + Rail — the outer chrome every screen sits inside. `Frame`
 * owns spacers/rail/body/footer; `Rail` is the wordmark + eyebrow header.
 */

import type { ReactNode } from "react";

import { Mark } from "@/shared/components/primitives/Mark.tsx";

export interface FrameProps {
  children: ReactNode;
  /** Drop the standard 24px side padding and the rail. Used for scanner. */
  fullBleed?: boolean;
  /** Render the wordmark rail above body. Defaults to true; off for boot. */
  showRail?: boolean;
  /** Sticky footer row for primary actions. */
  footer?: ReactNode;
  className?: string;
}

export function Frame({ children, fullBleed = false, showRail = true, footer, className }: FrameProps) {
  const frameClass = ["editorial-frame", fullBleed ? "editorial-frame--full-bleed" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={frameClass}>
      <div className="editorial-frame__top-space" />
      {!fullBleed && showRail && <Rail />}
      <div className="editorial-frame__body">{children}</div>
      {footer ? <div className="editorial-frame__footer">{footer}</div> : null}
      <div className="editorial-frame__bottom-space" />
    </section>
  );
}

export function Rail() {
  return (
    <header className="rail">
      <div className="rail__brand">
        <Mark size={16} />
        <span className="rail__wordmark">W3S Receipts</span>
      </div>
      <span className="rail__eyebrow">Web3 · Berlin · pilot</span>
    </header>
  );
}

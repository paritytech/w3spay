/**
 * Editorial headline — the large serif title every "single-message" screen
 * is built around. `suffix` renders an italic tinted "second clause"
 * after the main title (`"Welcome to" + "W3sPay."`); `suffixTone` colors
 * the suffix without touching the main title.
 */

import type { CSSProperties, ReactNode } from "react";

export interface HeadProps {
  children: ReactNode;
  /** Editorial italic + tinted "second clause" rendered after the main title. */
  suffix?: ReactNode;
  suffixTone?: "tertiary" | "warn" | "danger" | "success";
  size?: number;
  italic?: boolean;
  style?: CSSProperties;
}

export function Head({ children, suffix, suffixTone = "tertiary", size = 38, italic, style }: HeadProps) {
  const headStyle: CSSProperties = {
    fontSize: size,
    fontStyle: italic ? "italic" : undefined,
    ...style,
  };
  const suffixClass = suffixTone === "tertiary"
    ? "editorial-head__suffix"
    : `editorial-head__suffix editorial-head__suffix--${suffixTone}`;
  return (
    <h1 className="editorial-head" style={headStyle}>
      {children}
      {suffix ? <> <span className={suffixClass}>{suffix}</span></> : null}
    </h1>
  );
}

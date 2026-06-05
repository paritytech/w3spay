/**
 * Eyebrow — small, all-caps, letter-spaced label that sits above a
 * <Head>. Tone tints it for warn/danger/success states; default is muted.
 */

import type { ReactNode } from "react";

export type EyebrowTone = "muted" | "warn" | "danger" | "success";

export interface EyebrowProps {
  children: ReactNode;
  tone?: EyebrowTone;
}

export function Eyebrow({ children, tone = "muted" }: EyebrowProps) {
  const cls = tone === "muted" ? "eyebrow" : `eyebrow eyebrow--${tone}`;
  return <p className={cls}>{children}</p>;
}

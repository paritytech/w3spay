/**
 * Dotted — a horizontal dotted divider. Editorial sectioning between
 * eyebrow / head, sub, and footer meta.
 */

import type { CSSProperties } from "react";

export function Dotted({ style }: { style?: CSSProperties }) {
  return <div className="dotted" style={style} />;
}

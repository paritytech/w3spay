/**
 * Inline SVG icon set + the `<Icon>` primitive every screen draws from.
 *
 * Stays as a single file so additions (a new "share" icon, an "arrow-down",
 * …) don't fan out into ten tiny modules. The `ICONS` keys are also the
 * union the `<IconButton>` `icon` prop accepts, so it lives here too.
 */

import type { ReactNode } from "react";

export const ICONS: Record<string, ReactNode> = {
  check: <path d="M20 6 9 17l-5-5" />,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  "chevron-up": <path d="m18 15-6-6-6 6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  "chevron-left": <path d="m15 18-6-6 6-6" />,
  "arrow-up": <><line x1="12" y1="19" x2="12" y2="5" /><path d="m5 12 7-7 7 7" /></>,
  "arrow-right": <><line x1="5" y1="12" x2="19" y2="12" /><path d="m12 5 7 7-7 7" /></>,
  camera: <>
    <path d="M14.5 4h-5L8 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3l-1.5-2Z" />
    <circle cx="12" cy="13" r="4" />
  </>,
  scan: <>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </>,
  "refresh-cw": <>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="m21 3 0 5-5 0" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="m3 21 0-5 5 0" />
  </>,
  "rotate-cw": <>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </>,
  history: <>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </>,
  copy: <>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>,
  // Flash bolt — used by the live camera torch toggle.
  flash: <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />,
  // Purchase receipt — saved-receipts section nav + confirmation.
  receipt: <>
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
    <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
    <path d="M12 17.5v-11" />
  </>,
  // Picture frame — "save as image" affordance on the receipt detail.
  image: <>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </>,
};

export type IconName = keyof typeof ICONS | string;

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  color?: string;
}

export function Icon({ name, size = 16, strokeWidth = 1.75, color = "currentColor" }: IconProps) {
  const inner = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "inline-block", flexShrink: 0 }}
      aria-hidden="true"
    >
      {inner}
    </svg>
  );
}

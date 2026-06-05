/**
 * Editorial buttons — PrimaryButton, SecondaryButton, IconButton.
 *
 * One file because they share `ButtonProps` and IconButton consumes the
 * same `IconName` union; splitting further would just fan out a single
 * stylesheet's worth of components.
 */

import type { ReactNode } from "react";

import { Icon, type IconName } from "@/shared/components/primitives/Icon.tsx";

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  full?: boolean;
  type?: "button" | "submit";
}

export function PrimaryButton({ children, onClick, disabled, full = true, type = "button" }: ButtonProps) {
  const cls = ["btn", "btn--primary", full ? "btn--full" : ""].filter(Boolean).join(" ");
  return (
    <button className={cls} type={type} onClick={onClick} disabled={disabled} aria-disabled={disabled}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled, full = true, type = "button" }: ButtonProps) {
  const cls = ["btn", "btn--secondary", full ? "btn--full" : ""].filter(Boolean).join(" ");
  return (
    <button className={cls} type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export interface IconButtonProps {
  onClick: () => void;
  label: string;
  icon: IconName;
  glass?: boolean;
}

export function IconButton({ onClick, label, icon, glass }: IconButtonProps) {
  const cls = glass ? "icon-btn icon-btn--glass" : "icon-btn";
  return (
    <button className={cls} type="button" onClick={onClick} aria-label={label}>
      <Icon name={icon} size={16} />
    </button>
  );
}

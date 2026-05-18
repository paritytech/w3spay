import type { ReactNode } from "react";

export interface InfoScreenProps {
  title: string;
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Generic single-card screen used for boot, errors, "merchant not in
 * pilot", "already paid", and other non-interactive states. The action
 * button is optional — terminal states (e.g. `hostUnavailable`) omit it.
 */
export function InfoScreen({
  title,
  children,
  actionLabel,
  onAction,
}: InfoScreenProps) {
  return (
    <section className="screen info-screen">
      <header className="screen-head">
        <h2 className="screen-title">{title}</h2>
      </header>
      <p className="screen-body">{children}</p>
      {actionLabel && onAction ? (
        <div className="actions">
          <button className="primary" type="button" onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      ) : null}
    </section>
  );
}

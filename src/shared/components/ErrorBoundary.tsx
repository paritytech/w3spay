// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Top-level error boundary. Without it any render error unmounts the whole
 * React tree, leaving an empty `#root` that paints as a black page.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

import { captureError } from "@/telemetry";

interface ErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[w3spay/ErrorBoundary] render crashed", error, info);
    // componentStack ships as an extra (not a tag) so the dashboard shows it
    // without it counting as PII; `boundary` is a categorical tag.
    captureError(error, { boundary: "root" }, { componentStack: info.componentStack });
    this.setState({ error, info });
  }

  private handleReload = (): void => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render(): ReactNode {
    const { error, info } = this.state;
    if (error == null) return this.props.children;

    const stackPeek = (info?.componentStack ?? error.stack ?? "")
      .trim()
      .split("\n")
      .slice(0, 6)
      .join("\n");

    return (
      <section className="workspace">
        <section className="editorial-frame">
          <div className="editorial-frame__top-space" />
          <header className="rail">
            <span className="rail__wordmark" style={{ fontSize: 15 }}>W3S Receipts</span>
            <span className="rail__eyebrow" style={{ color: "#f87171" }}>Crashed</span>
          </header>
          <div className="editorial-frame__body">
            <p className="eyebrow eyebrow--danger" style={{ marginTop: 14 }}>Render error</p>
            <h1
              className="editorial-head"
              style={{ fontSize: 40, marginTop: 14 }}
            >
              Something{" "}
              <span className="editorial-head__suffix editorial-head__suffix--danger">broke.</span>
            </h1>
            <div className="dotted" style={{ marginTop: 22 }} />
            <p className="editorial-sub">
              The page hit an unexpected error. The console has the full stack; the first lines are below so you
              can decide whether to reload or report it.
            </p>
            <div style={{ flex: 1 }} />
            <div className="dotted" />
            <p className="eyebrow">Message</p>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "#f87171",
                marginTop: 8,
                paddingBottom: 12,
                wordBreak: "break-word",
              }}
            >
              {error.name}: {error.message}
            </div>
            <p className="eyebrow">Where</p>
            <pre
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-text-tertiary)",
                marginTop: 8,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                paddingBottom: 12,
                lineHeight: 1.5,
              }}
            >
              {stackPeek || "(no stack)"}
            </pre>
          </div>
          <div className="editorial-frame__footer">
            <button className="btn btn--primary btn--full" type="button" onClick={this.handleReload}>
              Reload
            </button>
          </div>
          <div className="editorial-frame__bottom-space" />
        </section>
      </section>
    );
  }
}

/**
 * Full-bleed scanner screen. Wraps the platform-dispatching `Scanner`
 * component with surrounding chrome — Roman step counter + headline up
 * top, balance chip + footer hint at the bottom, wallet nav button.
 * The camera region itself is a plain square viewport (no reticle, no
 * scrim) — the active backend owns the `<video>` it mounts there.
 *
 * The top-right `$` button opens the wallet overlay (Activity + Receipts
 * tabs) — see `wallet-view-context.tsx` / `WalletScreen.tsx`.
 */

import { Scanner } from "@/features/scan/components/Scanner.tsx";
import type { ScannerError } from "@/features/scan/lib/scanner-types.ts";
import { Spinner } from "@/shared/components/Spinner.tsx";
import { IconButton, Mark } from "@/shared/components/primitives.tsx";
import { formatAmountCents } from "@/shared/utils/format-amount.ts";
import { ASSET_LABEL } from "@/shared/utils/format.ts";

export interface ScanningScreenProps {
  onDecoded: (text: string) => void;
  onPermissionDenied: () => void;
  onScannerStartError: (error: ScannerError) => void;
  onOpenWallet: () => void;
  /** Vault's available balance in cents, or `null` while recovering. */
  availableCents: number | null;
  /**
   * `true` once the balance permission modal has been resolved.
   * The host only renders one permission modal at a time — kicking off
   * the camera request before the balance one closes silently drops it.
   */
  permissionsReady: boolean;
}

export function ScanningScreen({
  onDecoded,
  onPermissionDenied,
  onScannerStartError,
  onOpenWallet,
  availableCents,
  permissionsReady,
}: ScanningScreenProps) {
  const amount = availableCents !== null ? formatAmountCents(availableCents) : null;

  return (
    <section className="editorial-frame editorial-frame--full-bleed scanning">
      {/* Live camera fills the center; the Scanner manages its own startup overlay. */}
      <div className="scanning__camera">
        {permissionsReady ? (
          <Scanner
            onDecoded={onDecoded}
            onPermissionDenied={onPermissionDenied}
            onStartError={(err) =>
              err.code === "permissionDenied"
                ? onPermissionDenied()
                : onScannerStartError(err)
            }
          />
        ) : (
          <div className="scanner-wrap">
            <div className="scanning__overlay" role="status">
              <Spinner label="Just a moment…" />
            </div>
          </div>
        )}
      </div>


      <div className="scanning__top">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 26,
                letterSpacing: "-0.02em",
                fontStyle: "italic",
                color: "var(--color-text-primary)",
              }}
            >
              I
              <span style={{ color: "var(--color-text-faint)", fontSize: 14, fontStyle: "normal" }}>
                {" "}
                / III
              </span>
            </span>
            <span
              style={{
                color: "var(--color-text-secondary)",
                fontSize: 10,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
              }}
            >
              Scan to pay
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Mark size={16} />
              <span style={{ fontFamily: "var(--font-serif)", fontSize: 13, color: "var(--color-text-primary)" }}>
                W3sPay
              </span>
            </div>
            <IconButton onClick={onOpenWallet} label="Wallet" icon="history" glass />
          </div>
        </div>
        <p className="scanning__title">
          Find the small code{" "}
          <span className="scanning__title-suffix">at the bottom of the slip.</span>
        </p>
      </div>

      <div className="scanning__bottom">
        <div className="scanning__balance-chip">
          <div className="scanning__balance-chip-amount">
            <span
              style={{
                color: "var(--color-text-muted)",
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              Balance
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 15 }}>
              {amount !== null ? `${amount} ${ASSET_LABEL}` : "—"}
            </span>
          </div>
          <span className="scanning__balance-chip-live">
            <span className="scanning__balance-chip-live-dot" />
            live
          </span>
        </div>
        <p className="scanning__footer-hint">Hold steady — we'll read it for you.</p>
      </div>
    </section>
  );
}

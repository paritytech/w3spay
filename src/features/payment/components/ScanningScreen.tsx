// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Full-bleed scanner screen. The active backend owns the `<video>` it mounts
 * in the centered camera region; a corner-bracket reticle frames it, top/bottom
 * scrims seat the editorial chrome (brand bar, step header, hint) over the feed.
 */

import { Scanner } from "@/features/scan/components/Scanner.tsx";
import type { ScannerError } from "@/features/scan/lib/scanner-types.ts";
import { Spinner } from "@/shared/components/Spinner.tsx";
import { IconButton, Mark } from "@/shared/components/primitives.tsx";

export interface ScanningScreenProps {
  onDecoded: (text: string) => void;
  onPermissionDenied: () => void;
  onScannerStartError: (error: ScannerError) => void;
  onOpenWallet: () => void;
  /** `true` once the camera grant resolved. Mounts `<video>` only when ready. */
  permissionsReady: boolean;
}

export function ScanningScreen({
  onDecoded,
  onPermissionDenied,
  onScannerStartError,
  onOpenWallet,
  permissionsReady,
}: ScanningScreenProps) {
  return (
    <section className="editorial-frame editorial-frame--full-bleed scanning">
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

      {permissionsReady ? (
        <div className="scanning__reticle" aria-hidden="true">
          <div className="scanning__window">
            <span className="scanning__corner scanning__corner--tl" />
            <span className="scanning__corner scanning__corner--tr" />
            <span className="scanning__corner scanning__corner--bl" />
            <span className="scanning__corner scanning__corner--br" />
          </div>
        </div>
      ) : null}

      <div className="scanning__scrim scanning__scrim--top" aria-hidden="true" />
      <div className="scanning__scrim scanning__scrim--bottom" aria-hidden="true" />

      <header className="scanning__bar">
        <Mark size={20} />
        <IconButton onClick={onOpenWallet} label="Wallet" icon="history" glass />
      </header>

      <div className="scanning__head">
        <h1 className="scanning__title">
          Scan the receipt <span className="scanning__title-suffix">QR code.</span>
        </h1>
      </div>

      <div className="scanning__bottom">
        <p className="scanning__footer-hint">Hold steady — we'll read it for you.</p>
      </div>
    </section>
  );
}

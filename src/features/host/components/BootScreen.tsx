// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Boot — the splash shown while the host bridge resolves.
 */

import { Frame, Mark } from "@/shared/components/primitives.tsx";
import { Spinner } from "@/shared/components/Spinner.tsx";

export function BootScreen() {
  return (
    <Frame showRail={false}>
      <div className="boot">
        <Mark size={56} />
        <div>
          <div className="boot__wordmark">W3S Receipts</div>
          <div className="boot__tagline">by Polkadot.</div>
        </div>
      </div>
      <div style={{ paddingBottom: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div className="boot__status">
          <Spinner size={12} />
          <span>One moment</span>
        </div>
      </div>
    </Frame>
  );
}

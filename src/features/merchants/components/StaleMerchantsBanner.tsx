// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Warn-tone banner shown when the merchant registry couldn't load after
 * 2 minutes of retries with no cached copy (`failed: true`).
 */

import { useMerchantTable } from "@/features/merchants/api/queries.ts";

export interface StaleMerchantsCopy {
  readonly label: string;
  readonly body: string;
}

/** Pure helper for tests. Returns `null` when the banner stays hidden. */
export function staleMerchantsCopy(failed: boolean): StaleMerchantsCopy | null {
  if (!failed) return null;
  return {
    label: "Merchant directory unreachable.",
    body: "Couldn't reach the merchant directory and no cached copy is available. Scans will land on 'not on W3S Receipts yet' until the directory loads.",
  };
}

export function StaleMerchantsBanner() {
  const { failed } = useMerchantTable();
  const copy = staleMerchantsCopy(failed);
  if (copy === null) return null;
  return (
    <div className="dummy-balance-banner" role="status" aria-live="polite">
      <span className="dummy-balance-banner__dot" aria-hidden="true" />
      <span className="dummy-balance-banner__text">
        <strong className="dummy-balance-banner__label">{copy.label}</strong>{" "}
        {copy.body}
      </span>
    </div>
  );
}
// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * App-local telemetry: instantiates the singleton `journeyTracker` with w3spay's
 * journey types and common attributes (`app.name`, `app.env`, `host.kind`).
 * Privacy enforcement lives in `@/telemetry`'s `scrub.ts` — the
 * `recordJourneyAttribute` guard rejects keys matching `SENSITIVE_KEY_RE` and
 * any string value longer than 32 chars.
 */

import { detectHostEnvironment } from "@/shared/api/host";
import { JourneyTracker } from "@/telemetry";


/**
 * Journey kinds emitted by w3spay. Keep small — each journey burns one span per
 * session and commits the dashboard to a new categorical filter.
 */
export type AppJourneyType =
  | "w3spay:app-boot"
  | "w3spay:qr-scan"
  | "w3spay:customer-pay"
  | "w3spay:dev-pay";

/** Sentry `op` per journey root span. Keep stable — changing them invalidates the dashboard's saved searches. */
const APP_JOURNEY_OPS: Readonly<Record<AppJourneyType, string>> = {
  "w3spay:app-boot": "journey.w3spay:app-boot",
  "w3spay:qr-scan": "journey.w3spay:qr-scan",
  "w3spay:customer-pay": "journey.w3spay:customer-pay",
  "w3spay:dev-pay": "journey.w3spay:dev-pay",
};

/**
 * Map the host-detection enum onto a short telemetry tag: `web-iframe` → dotli's
 * iframe, `desktop-webview` → Polkadot Desktop's webview, `standalone` → browser.
 */
function hostKindTag(): "dotli" | "native" | "browser" {
  switch (detectHostEnvironment()) {
    case "web-iframe":
      return "dotli";
    case "desktop-webview":
      return "native";
    case "standalone":
      return "browser";
  }
}

/** Singleton tracker, imported directly — no provider, since it holds no React state. */
export const journeyTracker = new JourneyTracker<AppJourneyType>({
  ops: APP_JOURNEY_OPS,
  commonAttributes: {
    "app.name": "w3spay",
    "app.env": (import.meta.env.MODE as string | undefined) ?? "development",
    "host.kind": hostKindTag(),
  },
});

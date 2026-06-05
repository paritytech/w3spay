/**
 * App-local telemetry surface for w3spay.
 *
 * Instantiates the singleton `journeyTracker` with the journey types
 * the customer flow actually emits, plus the common attributes
 * (`app.name`, `app.env`, `host.kind`) that every span needs. Call
 * sites import `journeyTracker` directly:
 *
 *   import { journeyTracker } from "@/shared/utils/telemetry.ts";
 *   journeyTracker.start("customer-pay", { "payment.tipped": true });
 *   journeyTracker.complete("customer-pay", { "payment.settlement": "settled" });
 *
 * Privacy enforcement is in `@/telemetry`'s `scrub.ts` — the
 * `recordJourneyAttribute` guard refuses any key matching
 * `SENSITIVE_KEY_RE` and any string value longer than 32 chars.
 */

import { detectHostEnvironment } from "@/shared/api/host";
import { JourneyTracker } from "@/telemetry";


/**
 * Journey kinds emitted by w3spay. Keep this list small — every
 * journey burns one span per session, and adding journeys here
 * commits the dashboard to a new categorical filter.
 */
export type AppJourneyType =
  | "app-boot"
  | "qr-scan"
  | "customer-pay"
  | "dev-pay";

/**
 * Sentry `op` for each journey's root span. Keep these stable —
 * changing them invalidates the dashboard's saved searches.
 */
const APP_JOURNEY_OPS: Readonly<Record<AppJourneyType, string>> = {
  "app-boot": "journey.app-boot",
  "qr-scan": "journey.qr-scan",
  "customer-pay": "journey.customer-pay",
  "dev-pay": "journey.dev-pay",
};

/**
 * Map the synchronous host-detection enum onto a short categorical
 * tag for telemetry. `"web-iframe"` is dotli's iframe container,
 * `"desktop-webview"` is Polkadot Desktop's native webview,
 * `"standalone"` is a plain browser tab.
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

/**
 * Singleton tracker. App code imports this directly — there is no
 * provider, since the tracker has no React state.
 */
export const journeyTracker = new JourneyTracker<AppJourneyType>({
  ops: APP_JOURNEY_OPS,
  commonAttributes: {
    "app.name": "w3spay",
    "app.env": (import.meta.env.MODE as string | undefined) ?? "development",
    "host.kind": hostKindTag(),
  },
});

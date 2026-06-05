/**
 * Single facade over the low-level Novasama Host API SDK.
 *
 * Product apps import host-sdk primitives through this module instead of
 * importing `@novasamatech/host-api-wrapper` directly. The wrapper owns a
 * module-level transport singleton and assigns the Desktop webview
 * `MessagePort.onmessage` handler; bundling multiple physical copies causes
 * those handlers to clobber each other and drops handshake responses.
 */
export {
  createPaymentManager,
  hostApi,
  hostLocalStorage,
  preimageManager,
  requestPermission,
  sandboxProvider,
  sandboxTransport,
} from "@novasamatech/host-api-wrapper";
export type { PaymentStatus, ProductAccount } from "@novasamatech/host-api-wrapper";

export { assertEnumVariant, enumValue } from "@novasamatech/host-api";
export type { HexString } from "@novasamatech/host-api";

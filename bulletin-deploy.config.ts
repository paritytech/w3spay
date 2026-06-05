import { defineConfig } from "bulletin-deploy";

// Product manifest for the W3SPay cashier SPA. `./deploy.sh` publishes this to
// DotNS as `w3spay.dot`; the `domain` here MUST equal that deploy target or
// `publishManifest` aborts.
//
// `icon.path` and every `executables[].path` are resolved relative to THIS
// file. `./dist` is Vite's default build output and is exactly the directory
// `deploy.sh` uploads, so the app executable reuses that already-uploaded CID
// instead of re-storing the same bytes. This is a single-entry SPA — there is
// no widget or worker build, so `app` is the only executable.
export default defineConfig({
  domain: "w3spay.dot",
  displayName: "W3SPay",
  description: "Payment app for Web3 Summit",
  icon: { path: "./icon.png", format: "png" },
  executables: [
    {
      kind: "app",
      path: "./dist",
      appVersion: [0, 1, 0],
    },
  ],
});

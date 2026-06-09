import { defineConfig } from "bulletin-deploy";

const domain = process.env.VITE_DOTNS_PRODUCT_DOMAIN;
if (!domain) {
  throw new Error(
    "VITE_DOTNS_PRODUCT_DOMAIN is not set. This env var must be set to the target DotNS domain for the deploy, and it is also embedded into the build as the product identity.",
  );
}

export default defineConfig({
  domain,
  displayName: "W3S Receipts",
  description: "Receipts app for Web3 Summit",
  icon: { path: "./icon.png", format: "png" },
  executables: [
    {
      kind: "app",
      path: "./dist",
      appVersion: [0, 1, 0],
    },
  ],
});

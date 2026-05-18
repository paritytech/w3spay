#!/usr/bin/env bash
#
# deploy.sh - Build and deploy the W3SPay SPA as a .dot product.
#
# Usage:
#   ./deploy.sh [name-or-domain]
#
# Defaults to "w3spay.dot" if no name is given.
#
# Required env:
#   - MNEMONIC or DOTNS_MNEMONIC
#
# Optional env:
#   - DOTNS_GATEWAY_BASE      Final gateway host suffix (default: dot.li)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/dist"
GATEWAY_BASE="${DOTNS_GATEWAY_BASE:-dot.li}"
TARGET="${1:-w3spay.dot}"
MIN_BULLETIN_DEPLOY_VERSION="0.7.12"

if [[ "$TARGET" != *.dot ]]; then
  TARGET="${TARGET}.dot"
fi

version_gte() {
  local current="$1"
  local minimum="$2"
  local current_major current_minor current_patch
  local minimum_major minimum_minor minimum_patch

  IFS=. read -r current_major current_minor current_patch <<<"$current"
  IFS=. read -r minimum_major minimum_minor minimum_patch <<<"$minimum"

  [[ "$current_major" =~ ^[0-9]+$ ]] || return 1
  [[ "$current_minor" =~ ^[0-9]+$ ]] || return 1
  [[ "$current_patch" =~ ^[0-9]+$ ]] || return 1

  if (( current_major != minimum_major )); then
    (( current_major > minimum_major ))
    return
  fi
  if (( current_minor != minimum_minor )); then
    (( current_minor > minimum_minor ))
    return
  fi
  (( current_patch >= minimum_patch ))
}

if ! command -v bulletin-deploy >/dev/null 2>&1; then
  echo "Error: bulletin-deploy is required for current DotNS deployments."
  echo ""
  echo "Install it first:"
  echo "  npm install -g bulletin-deploy@latest"
  exit 1
fi

BULLETIN_DEPLOY_VERSION="$(bulletin-deploy --version | sed -E 's/.*v?([0-9]+[.][0-9]+[.][0-9]+).*/\1/')"
if ! version_gte "$BULLETIN_DEPLOY_VERSION" "$MIN_BULLETIN_DEPLOY_VERSION"; then
  echo "Error: bulletin-deploy ${MIN_BULLETIN_DEPLOY_VERSION} or newer is required for Paseo deployments."
  echo "Found: ${BULLETIN_DEPLOY_VERSION:-unknown}"
  echo ""
  echo "Update it first:"
  echo "  npm install -g bulletin-deploy@latest"
  echo ""
  echo "Versions before 0.7.12 do not support the current Bulletin authorization logic."
  exit 1
fi

if [[ -z "${MNEMONIC:-}" && -n "${DOTNS_MNEMONIC:-}" ]]; then
  export MNEMONIC="$DOTNS_MNEMONIC"
fi

if [[ -z "${MNEMONIC:-}" ]]; then
  echo "Error: MNEMONIC env var is required."
  echo ""
  echo "  export MNEMONIC=\"your twelve word mnemonic phrase here\""
  echo ""
  echo "DOTNS_MNEMONIC is also accepted as a compatibility alias."
  echo "Never put your mnemonic in a file or commit it to git."
  exit 1
fi

echo "==> Building W3SPay SPA..."
npm --prefix "$SCRIPT_DIR" run build

echo "==> Copying dot.li manifest..."
cp "$SCRIPT_DIR/bundle/manifest.toml" "$BUILD_DIR/manifest.toml"

if [[ ! -f "$BUILD_DIR/manifest.toml" ]]; then
  echo "Error: manifest.toml was not copied into the build output."
  exit 1
fi

echo ""
echo "==> Deploying ${TARGET} assets to Bulletin with bulletin-deploy..."
bulletin-deploy "$BUILD_DIR" "$TARGET"

NAME="${TARGET%.dot}"
echo ""
echo "==> Done! Live at:"
echo "    https://${NAME}.${GATEWAY_BASE}"

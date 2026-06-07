#!/bin/bash
# Release QuickEdit for Squarespace to the Chrome Web Store + GitHub.
# Usage:
#   ./scripts/release-chrome.sh <version>                  # upload as draft
#   ./scripts/release-chrome.sh <version> --auto-publish   # upload + publish
#   ./scripts/release-chrome.sh <version> --dry-run        # build only
#
# Credentials live in macOS Keychain under service "QuickEditForSquarespace_CWS":
#   security add-generic-password -s QuickEditForSquarespace_CWS -a clientId      -w 'GOOG_OAUTH_CLIENT_ID'
#   security add-generic-password -s QuickEditForSquarespace_CWS -a clientSecret  -w 'GOOG_OAUTH_CLIENT_SECRET'
#   security add-generic-password -s QuickEditForSquarespace_CWS -a refreshToken  -w 'GOOG_OAUTH_REFRESH_TOKEN'
#   security add-generic-password -s QuickEditForSquarespace_CWS -a extensionId   -w 'YOUR_CWS_EXTENSION_ID'
# See https://github.com/fregante/chrome-webstore-upload-keys for the bootstrap flow.

set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &>/dev/null && pwd )"
REPO_DIR="$( dirname "$SCRIPT_DIR" )"
DIST_DIR="$REPO_DIR/dist"

# Preflight: `--check` verifies all four credentials are present (no secrets printed).
if [[ "${1:-}" == "--check" ]]; then
  ok=1
  for acct in clientId clientSecret refreshToken extensionId; do
    if security find-generic-password -s QuickEditForSquarespace_CWS -a "$acct" -w >/dev/null 2>&1; then
      echo "  ✓ $acct"
    else
      echo "  ✗ $acct (missing)"; ok=0
    fi
  done
  [ "$ok" = 1 ] && { echo "✓ all Chrome Web Store credentials present"; exit 0; } \
                || { echo "❌ set the missing entries (see this script's header)"; exit 1; }
fi

VERSION="${1:?usage: $0 <version> [--auto-publish|--dry-run|--check]}"
MODE="${2:-}"

# Build the zip.
"$SCRIPT_DIR/build-chrome.sh" "$VERSION"
ZIP_PATH="$DIST_DIR/QuickEditForSquarespace-$VERSION-chrome.zip"

if [[ "$MODE" == "--dry-run" ]]; then
  echo "✓ dry run; zip at $ZIP_PATH"
  exit 0
fi

# Fetch keychain creds.
keychain_get() {
  if ! security find-generic-password -s QuickEditForSquarespace_CWS -a "$1" -w 2>/dev/null; then
    echo "❌ missing keychain entry: service=QuickEditForSquarespace_CWS account=$1" >&2
    echo "   set it with:" >&2
    echo "     security add-generic-password -s QuickEditForSquarespace_CWS -a $1 -w '<value>'" >&2
    exit 1
  fi
}

CLIENT_ID=$(keychain_get clientId)
CLIENT_SECRET=$(keychain_get clientSecret)
REFRESH_TOKEN=$(keychain_get refreshToken)
EXT_ID=$(keychain_get extensionId)
export CLIENT_ID CLIENT_SECRET REFRESH_TOKEN

echo "→ uploading to Chrome Web Store ($EXT_ID)…"
npx --yes chrome-webstore-upload-cli@3 upload \
  --source "$ZIP_PATH" \
  --extension-id "$EXT_ID"

if [[ "$MODE" == "--auto-publish" ]]; then
  echo "→ publishing…"
  npx --yes chrome-webstore-upload-cli@3 publish \
    --extension-id "$EXT_ID"
fi

# GitHub release (best-effort; skipped when this repo has no remote).
if command -v gh >/dev/null 2>&1 && git -C "$REPO_DIR" remote 2>/dev/null | grep -q .; then
  TAG="v$VERSION"
  if gh release view "$TAG" >/dev/null 2>&1; then
    echo "→ uploading zip to existing GitHub release $TAG…"
    gh release upload "$TAG" "$ZIP_PATH" --clobber || true
  else
    echo "→ creating GitHub release $TAG…"
    gh release create "$TAG" "$ZIP_PATH" \
      --title "QuickEdit for Squarespace $VERSION" \
      --generate-notes || echo "  (gh release create failed — make sure repo + remote are set up)"
  fi
else
  echo "  (gh CLI not installed — skipping GitHub release step)"
fi

echo "✓ chrome release $VERSION complete"

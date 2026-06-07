#!/bin/bash
# Build the Safari Web Extension app for local testing (Debug config).
# Usage: ./scripts/build-safari.sh

set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &>/dev/null && pwd )"
REPO_DIR="$( dirname "$SCRIPT_DIR" )"
SAFARI_DIR="$REPO_DIR/safari"
PROJECT="$SAFARI_DIR/QuickEdit for Squarespace.xcodeproj"
SCHEME="QuickEdit for Squarespace"
CONFIG="Debug"
# DerivedData must live outside the iCloud-synced ~/Documents/Claude/ tree —
# the file provider drops Finder metadata onto build products and codesign rejects them.
DERIVED="${TMPDIR:-/tmp}/quickedit-for-squarespace-derived"

find "$SAFARI_DIR" -exec xattr -c {} + 2>/dev/null || true
find "$REPO_DIR/extension" -exec xattr -c {} + 2>/dev/null || true
"$SCRIPT_DIR/sync-extension.sh"

# Clean any prior local build dir to avoid the "stale file" sandbox warnings.
rm -rf "$REPO_DIR/build/safari/Debug" "$SAFARI_DIR/build"

mkdir -p "$DERIVED"

echo "→ xcodebuild ($CONFIG)…"
# Debug builds are for "open in Safari to try it" — explicitly use ad-hoc
# signing so this works regardless of what real certs are in the Keychain.
# (Once an Apple Distribution cert is installed, automatic signing tries to
# use it for Debug too, and the app/extension can drift onto different certs.)
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -derivedDataPath "$DERIVED" \
  CODE_SIGN_IDENTITY=- \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="" \
  PROVISIONING_PROFILE_SPECIFIER="" \
  build

APP="$DERIVED/Build/Products/$CONFIG/QuickEdit for Squarespace.app"
if [[ ! -d "$APP" ]]; then
  echo "❌ build didn't produce $APP" >&2; exit 1
fi

# Stage the .app at a stable path under ~/Applications/ — Safari's pluginkit
# registration is unreliable for extensions whose host app lives under /tmp.
INSTALL_DIR="$HOME/Applications"
mkdir -p "$INSTALL_DIR"
INSTALLED="$INSTALL_DIR/QuickEdit for Squarespace.app"
rm -rf "$INSTALLED"
cp -R "$APP" "$INSTALLED"
# Re-register the embedded extension explicitly.
pluginkit -a "$INSTALLED/Contents/PlugIns/QuickEdit for Squarespace Extension.appex" 2>/dev/null || true

echo "✓ built $APP"
echo "✓ installed to $INSTALLED"
echo
echo "to enable the extension in Safari (debug builds need this every session):"
echo "  1. open '$INSTALLED'  (and keep it open for first registration)"
echo "  2. Safari → Settings → Advanced → 'Show features for web developers'"
echo "  3. Safari → Develop menu → 'Allow Unsigned Extensions'"
echo "  4. Safari → Settings → Extensions → enable 'QuickEdit for Squarespace'"
echo
echo "to verify Safari sees the extension:"
echo "  pluginkit -mAvvv | grep -i quickedit"

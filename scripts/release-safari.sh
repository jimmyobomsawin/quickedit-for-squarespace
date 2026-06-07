#!/bin/bash
# Release the Safari app to the Mac App Store.
# Usage:
#   ./scripts/release-safari.sh <version>             # archive + export + upload
#   ./scripts/release-safari.sh <version> --dry-run   # archive + export, skip upload
#
# Credentials live in macOS Keychain:
#   - Developer certificates: Apple Distribution (matches your Apple Developer team)
#   - Notary profile for altool: account-credentials saved as the Keychain item AC_PASSWORD
#     security add-generic-password -s AC_PASSWORD -a "$APPLE_ID" -w "<app-specific-password>"
#
# You also need APPLE_ID env var set, or in Keychain as "APPLE_ID":
#   security add-generic-password -s AC_PASSWORD -a appleId -w 'you@example.com'

set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &>/dev/null && pwd )"
REPO_DIR="$( dirname "$SCRIPT_DIR" )"
SAFARI_DIR="$REPO_DIR/safari"
PROJECT="$SAFARI_DIR/QuickEdit for Squarespace.xcodeproj"
SCHEME="QuickEdit for Squarespace"
RELEASE_DIR="$REPO_DIR/build/safari-release"

VERSION="${1:?usage: $0 <version> [--dry-run]}"
MODE="${2:-}"

# Strip xattrs and sync extension/
find "$SAFARI_DIR" -exec xattr -c {} + 2>/dev/null || true
find "$REPO_DIR/extension" -exec xattr -c {} + 2>/dev/null || true
"$SCRIPT_DIR/sync-extension.sh"

# Set the public version string deterministically. agvtool's new-marketing-version
# silently no-ops on this project, so edit the pbxproj directly.
PBXPROJ="$SAFARI_DIR/QuickEdit for Squarespace.xcodeproj/project.pbxproj"
sed -i '' "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $VERSION;/g" "$PBXPROJ"
# The build number must be unique and strictly increasing for every App Store
# Connect upload, even when the public version is unchanged. Use the git commit
# count (a monotonic integer) so re-uploads at the same version never collide.
BUILD_NUMBER="$(git -C "$REPO_DIR" rev-list --count HEAD 2>/dev/null || echo 1)"
sed -i '' "s/CURRENT_PROJECT_VERSION = [^;]*;/CURRENT_PROJECT_VERSION = $BUILD_NUMBER;/g" "$PBXPROJ"
echo "→ MARKETING_VERSION=$VERSION  build(CURRENT_PROJECT_VERSION)=$BUILD_NUMBER"

# Also update the extension's manifest.json so they stay in lockstep
# (Chrome and Safari ship the same extension version).
python3 - "$REPO_DIR/extension/manifest.json" "$VERSION" <<'PY'
import json, sys
path, version = sys.argv[1], sys.argv[2]
with open(path) as f: m = json.load(f)
m["version"] = version
with open(path, "w") as f: json.dump(m, f, indent=2, ensure_ascii=False); f.write("\n")
PY
"$SCRIPT_DIR/sync-extension.sh"

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

ARCHIVE="$RELEASE_DIR/QuickEditForSquarespace.xcarchive"

echo "→ archiving…"
# -allowProvisioningUpdates lets xcodebuild fetch/create the App Store
#   provisioning profiles automatically. Do NOT override CODE_SIGN_IDENTITY:
#   the project is set to automatic signing, and overriding the identity
#   conflicts with that ("automatically signed but Apple Distribution manually
#   specified"). Automatic signing picks Apple Distribution itself for
#   archives intended for App Store distribution.
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  archive 2>&1 | grep -E '^(===|warning:|error:|❌|✓|\*\*)' || true

if [[ ! -d "$ARCHIVE" ]]; then
  echo "❌ archive failed" >&2; exit 1
fi

echo "→ exporting for App Store…"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$RELEASE_DIR" \
  -exportOptionsPlist "$SCRIPT_DIR/exportOptions-appstore.plist" \
  -allowProvisioningUpdates 2>&1 | grep -E '^(===|warning:|error:|❌|✓|\*\*)' || true

PKG=$(ls "$RELEASE_DIR"/*.pkg 2>/dev/null | head -1)
if [[ -z "${PKG:-}" ]]; then
  echo "❌ export didn't produce a .pkg in $RELEASE_DIR" >&2; exit 1
fi
echo "✓ exported $PKG"

if [[ "$MODE" == "--dry-run" ]]; then
  echo "✓ dry run; open $PKG in Transporter to validate"
  open -R "$PKG"
  exit 0
fi

# Resolve Apple ID + app-specific password from Keychain.
APPLE_ID="${APPLE_ID:-$(security find-generic-password -s AC_PASSWORD -a appleId -w 2>/dev/null || true)}"
if [[ -z "$APPLE_ID" ]]; then
  echo "❌ APPLE_ID not set and no Keychain entry under service=AC_PASSWORD account=appleId" >&2
  echo "   set with: security add-generic-password -s AC_PASSWORD -a appleId -w 'you@example.com'" >&2
  exit 1
fi

echo "→ uploading to App Store Connect ($APPLE_ID)…"
xcrun altool --upload-app \
  -f "$PKG" \
  -t osx \
  -u "$APPLE_ID" \
  --password "@keychain:AC_PASSWORD"

# Best-effort GitHub release.
if command -v gh >/dev/null 2>&1; then
  TAG="v$VERSION"
  SRC_ZIP="$REPO_DIR/dist/QuickEditForSquarespace-$VERSION-source.zip"
  ( cd "$REPO_DIR/extension" && zip -rq "$SRC_ZIP" . -x ".*" -x "**/.*" )
  if gh release view "$TAG" >/dev/null 2>&1; then
    gh release upload "$TAG" "$SRC_ZIP" --clobber || true
  else
    gh release create "$TAG" "$SRC_ZIP" \
      --title "QuickEdit for Squarespace $VERSION" \
      --notes "Mac App Store build uploaded to App Store Connect for review." || true
  fi
fi

echo "✓ safari release $VERSION uploaded to App Store Connect"
echo "  next: App Store Connect → My Apps → submit for review"

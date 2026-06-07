#!/bin/bash
# Build a Chrome Web Store-ready zip from extension/.
# Usage: ./scripts/build-chrome.sh [VERSION]
#   With VERSION, bumps extension/manifest.json first.
#   Without, uses the existing version.

set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &>/dev/null && pwd )"
REPO_DIR="$( dirname "$SCRIPT_DIR" )"
EXT_DIR="$REPO_DIR/extension"
DIST_DIR="$REPO_DIR/dist"

VERSION="${1:-}"

# Bump manifest version if a version arg was passed.
if [[ -n "$VERSION" ]]; then
  python3 - "$EXT_DIR/manifest.json" "$VERSION" <<'PY'
import json, sys
path, version = sys.argv[1], sys.argv[2]
with open(path) as f:
    m = json.load(f)
m["version"] = version
with open(path, "w") as f:
    json.dump(m, f, indent=2)
    f.write("\n")
print(f"  manifest.json → version {version}")
PY
fi

VERSION=$(python3 -c "import json; print(json.load(open('$EXT_DIR/manifest.json'))['version'])")
ZIP_NAME="QuickEditForSquarespace-$VERSION-chrome.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"

# Strip extended attrs that iCloud's file provider sometimes leaves on files
# in ~/Documents/Claude/ — they break codesign downstream and noisy-up zips.
find "$EXT_DIR" -exec xattr -c {} + 2>/dev/null || true

# Zip the CONTENTS of extension/ (manifest.json must be at the zip root).
# Exclude: hidden files, this repo's docs/python that aren't part of the extension.
( cd "$EXT_DIR" && zip -rq "$ZIP_PATH" . \
    -x ".*" "**/.*" \
    -x "*.md" \
    -x "old-README-snapshot.md" )

SIZE=$(du -h "$ZIP_PATH" | cut -f1)
echo "✓ built $ZIP_PATH ($SIZE)"

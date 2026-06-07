#!/bin/bash
# Sync extension/ → safari Extension target's Resources/ folder.
# extension/ is the single source of truth; the synced copy is what Xcode references.
# Run before any Safari build that should reflect upstream changes.

set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &>/dev/null && pwd )"
REPO_DIR="$( dirname "$SCRIPT_DIR" )"
SRC="$REPO_DIR/extension/"
DST="$REPO_DIR/safari/QuickEdit for Squarespace Extension/Resources/"

if [[ ! -d "$SRC" ]]; then
  echo "❌ source not found: $SRC" >&2; exit 1
fi
if [[ ! -d "$DST" ]]; then
  echo "❌ destination not found: $DST" >&2
  echo "   run safari-web-extension-converter first." >&2
  exit 1
fi

# Mirror — delete files in DST that aren't in SRC. Exclude dev-only files.
rsync -a --delete \
  --exclude '.DS_Store' \
  --exclude '*.md' \
  --exclude '*.py' \
  "$SRC" "$DST"

echo "✓ synced extension/ → safari Extension/Resources/"

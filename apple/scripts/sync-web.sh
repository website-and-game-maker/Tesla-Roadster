#!/bin/sh
# Copies the browser game into apple/Web so the apps bundle the exact same build.
# Runs automatically before every build of the Roadster target; safe to run by hand.
set -e
APPLE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$APPLE/.." && pwd)"
DEST="$APPLE/Web"
mkdir -p "$DEST"
find "$DEST" -mindepth 1 -maxdepth 1 ! -name .gitkeep -exec rm -rf {} +
cp "$ROOT/index.html" "$ROOT/manifest.webmanifest" "$DEST/"
for d in src vendor icons; do cp -R "$ROOT/$d" "$DEST/"; done
# developer pages and tooling stay out of the app
rm -f "$DEST/src/ui/demo.html" "$DEST/src/multiplayer/package.json"
echo "Synced the web game into $DEST"

#!/bin/bash
# Builds markupR.app: the release `markupr` binary as a menu bar app bundle.
#
#   scripts/make-app-bundle.sh [DEST_DIR]     (default ~/Applications)
#
# Launching the bundle with no arguments runs the menu bar app, which asks macOS for its own
# permissions on first run. This script does not launch anything and installs no login item.
#
# Signing is ad-hoc (`codesign --sign -`). An ad-hoc signature changes with every build, and
# macOS ties permission grants to the signature, so it asks for the permissions again after each
# rebuild. Signing with a Developer ID identity instead keeps the grants across builds.
set -euo pipefail

DEST_DIR="${1:-$HOME/Applications}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
case "${CARGO_TARGET_DIR:-}" in
  "") TARGET="$REPO/target" ;;
  /*) TARGET="$CARGO_TARGET_DIR" ;;
  *) TARGET="$PWD/$CARGO_TARGET_DIR" ;;
esac
export CARGO_TARGET_DIR="$TARGET"

(cd "$REPO" && cargo build --release -p markupr)
BIN="$TARGET/release/markupr"
[ -x "$BIN" ] || { echo "no release binary at $BIN" >&2; exit 1; }

VERSION="$(sed -n '/^\[workspace.package\]/,/^\[/s/^version *= *"\(.*\)"/\1/p' "$REPO/Cargo.toml" | head -1)"
[ -n "$VERSION" ] || { echo "workspace version not found" >&2; exit 1; }
SHORT_VERSION="${VERSION%%-*}"   # 3.0.0-dev -> 3.0.0 (the short version must be numeric)

mkdir -p "$DEST_DIR"
DEST_DIR="$(cd "$DEST_DIR" && pwd)"
APP="$DEST_DIR/markupR.app"
STAGE="$(mktemp -d "$DEST_DIR/.markupR.app.new.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
NEW="$STAGE/markupR.app"

mkdir -p "$NEW/Contents/MacOS"
cp "$BIN" "$NEW/Contents/MacOS/markupr"
cat > "$NEW/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.eddiesanjuan.markupr</string>
  <key>CFBundleName</key><string>markupR</string>
  <key>CFBundleDisplayName</key><string>markupR</string>
  <key>CFBundleExecutable</key><string>markupr</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$SHORT_VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>NSMicrophoneUsageDescription</key><string>markupR records your narration while you show an AI agent what to change.</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
plutil -lint -s "$NEW/Contents/Info.plist"
codesign --force --sign - --identifier com.eddiesanjuan.markupr "$NEW"

# Swap into place: the new bundle is complete before the old one moves.
OLD="$STAGE/markupR.app.old"
if [ -e "$APP" ]; then mv "$APP" "$OLD"; fi
mv "$NEW" "$APP"
rm -rf "$STAGE"
trap - EXIT
echo "$APP"

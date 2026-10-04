#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/dist}"
BUILD="$ROOT/.build-macos"
TOOLS="${NATIVE_TOOLS_DIR:-$BUILD/tools}"
GO="${GO_BIN:-go}"
mkdir -p "$BUILD" "$TOOLS" "$DEST"
DEST="$(cd "$DEST" && pwd)"
if [ ! -f "$TOOLS/ffmpeg" ] || [ ! -f "$TOOLS/ffprobe" ]; then
  python3 "$ROOT/macos/download_tools.py" "$TOOLS"
fi
APP="$DEST/Flow2Short Studio.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -swift-version 5 -target arm64-apple-macos13.0 -module-cache-path "$BUILD/swift-cache" \
  "$ROOT/macos/main.swift" -o "$APP/Contents/MacOS/Flow2Short" -framework AppKit -framework WebKit
(cd "$ROOT/server" && GOCACHE="$BUILD/go-cache" CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
  "$GO" build -trimpath -ldflags='-s -w' -o "$APP/Contents/Resources/flow2short-server" .)
cp "$ROOT/macos/Info.plist" "$APP/Contents/Info.plist"
cp -R "$ROOT/app" "$APP/Contents/Resources/"
cp -R "$ROOT/licenses" "$APP/Contents/Resources/"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$ROOT/macos/NATIVE_NOTICES.md" "$APP/Contents/Resources/"
cp "$TOOLS/ffmpeg" "$TOOLS/ffprobe" "$APP/Contents/Resources/"
ICONSET="$BUILD/AppIcon.iconset"
mkdir -p "$ICONSET"
for SIZE in 16 32 128 256 512; do
  sips -z "$SIZE" "$SIZE" "$ROOT/app/icons/icon-512.png" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
  DOUBLE=$((SIZE * 2))
  sips -z "$DOUBLE" "$DOUBLE" "$ROOT/app/icons/icon-512.png" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
python3 "$ROOT/macos/make_icon.py" "$ICONSET" "$APP/Contents/Resources/AppIcon.icns"
chmod +x "$APP/Contents/MacOS/Flow2Short" "$APP/Contents/Resources/flow2short-server" "$APP/Contents/Resources/ffmpeg" "$APP/Contents/Resources/ffprobe"
for FILE in ffmpeg ffprobe flow2short-server; do
  codesign --force --sign - "$APP/Contents/Resources/$FILE"
done
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP"
printf 'Built: %s\n' "$APP"

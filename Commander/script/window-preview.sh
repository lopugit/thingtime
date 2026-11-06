#!/usr/bin/env bash
set -euo pipefail
commander_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
preview_key="$(printf '%s' "$commander_root" | shasum -a 256 | cut -c1-12)"
preview_root="$HOME/Library/Caches/com.thingtime.Commander.window-preview/$preview_key"
preview_app="$preview_root/Commander Window Preview.app"
preview_executable="$preview_app/Contents/MacOS/CommanderWindowPreview"
if [[ "${1:-}" == "--clean" ]]; then
  pkill -TERM -f "^$preview_executable$" 2>/dev/null || true
  rm -rf -- "$preview_root"
  exit 0
fi
mkdir -p "$preview_app/Contents/MacOS"
swiftc -parse-as-library -o "$preview_executable" \
  "$commander_root/hosts/macos/Sources/Commander/Windows/CommanderUtilityWindow.swift" \
  "$commander_root/script/window-preview.swift"
/usr/bin/plutil -create xml1 "$preview_app/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleExecutable -string CommanderWindowPreview "$preview_app/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleIdentifier -string "com.thingtime.Commander.window-preview.$preview_key" "$preview_app/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleName -string 'Commander Window Preview' "$preview_app/Contents/Info.plist"
/usr/bin/plutil -insert CFBundlePackageType -string APPL "$preview_app/Contents/Info.plist"
printf '%s\n' "$preview_app"

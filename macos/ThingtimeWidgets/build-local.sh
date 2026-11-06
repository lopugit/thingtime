#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${THINGTIME_SIGNING_IDENTITY:?Set an installed Apple Development identity hash}"
: "${DEVELOPMENT_TEAM:?Set your Apple developer team ID}"
case "$THINGTIME_SIGNING_IDENTITY" in *[!A-Fa-f0-9]*|'') echo 'Use the certificate hash from security find-identity.' >&2; exit 1;; esac
identity_line=$(security find-identity -v -p codesigning | grep -F "$THINGTIME_SIGNING_IDENTITY" || true)
case "$identity_line" in *'Apple Development:'*) ;; *) echo 'A valid Apple Development identity is required for this local build.' >&2; exit 1;; esac
cache="$HOME/Library/Caches/ThingtimeWidgets"
derived="$cache/macOS"
stage="$cache/bundle-stage/Thingtime Widgets.app"
source_app="$derived/Build/Products/Debug/Thingtime Widgets.app"
installed="$HOME/Applications/Thingtime Widgets.app"
xcodegen generate
xcodebuild -project ThingtimeWidgets.xcodeproj -scheme ThingtimeWidgets \
  -destination 'platform=macOS,arch=arm64' -jobs 2 -derivedDataPath "$derived" \
  CODE_SIGNING_ALLOWED=NO DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  THINGTIME_WIDGET_GROUP="${THINGTIME_WIDGET_GROUP:-$DEVELOPMENT_TEAM.com.thingtime.widgets}" \
  THINGTIME_WEB_URL="${THINGTIME_WEB_URL:-https://thingtime.com}" build
[ -x "$source_app/Contents/MacOS/Thingtime Widgets" ]
mkdir -p "$cache/bundle-stage" "$HOME/Applications"
# Only these deterministic same-name staging/installation paths are replaced.
if [ -d "$stage" ]; then mv "$stage" "$cache/bundle-stage/previous-$(date +%s).app"; fi
ditto "$source_app" "$stage"
xattr -cr "$stage"
cat > "$cache/widget-signing.entitlements" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.app-sandbox</key><true/>
<key>com.apple.security.network.client</key><true/>
<key>com.apple.security.device.audio-input</key><true/>
<key>com.apple.security.application-groups</key><array><string>${THINGTIME_WIDGET_GROUP:-$DEVELOPMENT_TEAM.com.thingtime.widgets}</string></array>
</dict></plist>
PLIST
extension="$stage/Contents/PlugIns/ThingtimeWidgetsExtension.appex"
[ -d "$extension" ]
ditto "$cache/widget-signing.entitlements" "$cache/widget-extension-signing.entitlements"
/usr/libexec/PlistBuddy -c 'Delete :com.apple.security.network.client' "$cache/widget-extension-signing.entitlements"
/usr/libexec/PlistBuddy -c 'Delete :com.apple.security.device.audio-input' "$cache/widget-extension-signing.entitlements"
codesign --force --options runtime --timestamp --sign "$THINGTIME_SIGNING_IDENTITY" --entitlements "$cache/widget-extension-signing.entitlements" "$extension"
codesign --force --options runtime --timestamp --sign "$THINGTIME_SIGNING_IDENTITY" --entitlements "$cache/widget-signing.entitlements" "$stage"
codesign --verify --deep --strict "$stage"
codesign -dr - "$stage" > "$cache/designated-requirement.txt" 2>&1
codesign --force --options runtime --timestamp --sign "$THINGTIME_SIGNING_IDENTITY" --entitlements "$cache/widget-signing.entitlements" "$stage"
codesign -dr - "$stage" > "$cache/designated-requirement-rebuilt.txt" 2>&1
cmp "$cache/designated-requirement.txt" "$cache/designated-requirement-rebuilt.txt"
codesign --verify --deep --strict "$stage"
if [ -d "$installed" ]; then mv "$installed" "$cache/bundle-stage/installed-previous-$(date +%s).app"; fi
ditto "$stage" "$installed"
codesign --verify --deep --strict "$installed"
[ -x "$installed/Contents/MacOS/Thingtime Widgets" ]
printf 'Built: %s\nInstalled: %s\n' "$source_app" "$installed"

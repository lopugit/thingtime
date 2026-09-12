#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${THINGTIME_WIDGETS_SIGNING_IDENTITY:?Developer ID identity required}"
: "${THINGTIME_WIDGETS_RELEASE_VERSION:?Release version required}"
: "${THINGTIME_WIDGETS_BUILD_NUMBER:?Build number required}"
: "${THINGTIME_WIDGETS_GIT_COMMIT:?Exact source commit required}"
: "${APPLE_TEAM_ID:?Apple team required}"
: "${APPLE_API_KEY:?Notarization key path required}"
: "${APPLE_API_KEY_ID:?Notarization key ID required}"
: "${APPLE_API_ISSUER:?Notarization issuer required}"
case "$THINGTIME_WIDGETS_SIGNING_IDENTITY" in 'Developer ID Application:'*) ;; *) echo 'Developer ID Application signing is required; no development/ad-hoc fallback.' >&2; exit 2;; esac
[[ "$THINGTIME_WIDGETS_RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+[+.]build\.[0-9]+\.g[a-f0-9]{12}$ ]]
[[ "$THINGTIME_WIDGETS_BUILD_NUMBER" =~ ^[0-9]+$ ]]
[[ "$THINGTIME_WIDGETS_GIT_COMMIT" =~ ^[a-f0-9]{40}$ ]]
[[ "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]
cache="$HOME/Library/Caches/ThingtimeWidgets/production"
mkdir -p "$cache" release
stage="$(mktemp -d "$cache/stage.XXXXXX")"
verify="$(mktemp -d "$cache/verify.XXXXXX")"
trap 'rm -rf "$stage" "$verify"' EXIT
xcodegen generate
xcodebuild -project ThingtimeWidgets.xcodeproj -scheme ThingtimeWidgets -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$cache/DerivedData" -configuration Release CODE_SIGNING_ALLOWED=NO \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" THINGTIME_WIDGET_GROUP="$APPLE_TEAM_ID.com.thingtime.widgets" \
  THINGTIME_WEB_URL=https://thingtime.com CURRENT_PROJECT_VERSION="$THINGTIME_WIDGETS_BUILD_NUMBER" build
app="$stage/Thingtime Widgets.app"
ditto "$cache/DerivedData/Build/Products/Release/Thingtime Widgets.app" "$app"
info="$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :ThingtimeReleaseVersion string $THINGTIME_WIDGETS_RELEASE_VERSION" "$info"
/usr/libexec/PlistBuddy -c "Add :ThingtimeReleaseTag string widgets-v$THINGTIME_WIDGETS_RELEASE_VERSION" "$info"
/usr/libexec/PlistBuddy -c "Add :ThingtimeGitCommit string $THINGTIME_WIDGETS_GIT_COMMIT" "$info"
/usr/libexec/PlistBuddy -c 'Add :ThingtimeGitBranch string main' "$info"
cat > "$stage/app.entitlements" <<PLIST
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>com.apple.security.app-sandbox</key><true/>
<key>com.apple.security.network.client</key><true/>
<key>com.apple.security.device.audio-input</key><true/>
<key>com.apple.security.application-groups</key><array><string>$APPLE_TEAM_ID.com.thingtime.widgets</string></array>
</dict></plist>
PLIST
cp "$stage/app.entitlements" "$stage/extension.entitlements"
/usr/libexec/PlistBuddy -c 'Delete :com.apple.security.network.client' "$stage/extension.entitlements"
/usr/libexec/PlistBuddy -c 'Delete :com.apple.security.device.audio-input' "$stage/extension.entitlements"
xattr -cr "$app"
codesign --force --options runtime --timestamp --sign "$THINGTIME_WIDGETS_SIGNING_IDENTITY" --entitlements "$stage/extension.entitlements" "$app/Contents/PlugIns/ThingtimeWidgetsExtension.appex"
codesign --force --options runtime --timestamp --sign "$THINGTIME_WIDGETS_SIGNING_IDENTITY" --entitlements "$stage/app.entitlements" "$app"
codesign --verify --deep --strict "$app"
ditto -c -k --keepParent "$app" "$stage/notary.zip"
xcrun notarytool submit "$stage/notary.zip" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
xcrun stapler staple "$app"
script/verify-production-bundle.sh "$app"
archive="release/Thingtime-Widgets-App-Release-$THINGTIME_WIDGETS_RELEASE_VERSION-macos-arm64.zip"
ditto -c -k --keepParent "$app" "$archive"
ditto -x -k "$archive" "$verify"
script/verify-production-bundle.sh "$verify/Thingtime Widgets.app"
printf '%s\n' "$archive"

#!/usr/bin/env bash
set -euo pipefail
app="${1:?Supply the extracted Widgets app}"
test -x "$app/Contents/MacOS/Thingtime Widgets"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" = com.thingtime.widgets
extension="$app/Contents/PlugIns/ThingtimeWidgetsExtension.appex"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$extension/Contents/Info.plist")" = com.thingtime.widgets.extension
codesign --verify --deep --strict "$app"
for bundle in "$extension" "$app"; do
  details="$(codesign -dvv "$bundle" 2>&1)"
  [[ "$details" == *'Authority=Developer ID Application:'* ]]
  [[ "$details" == *"TeamIdentifier=${APPLE_TEAM_ID:?APPLE_TEAM_ID required}"* ]]
done
xcrun stapler validate "$app"
spctl --assess --type execute --verbose=2 "$app"

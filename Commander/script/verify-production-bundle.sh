#!/usr/bin/env bash
set -euo pipefail

app="${1:?usage: verify-production-bundle.sh <Commander.app>}"
: "${APPLE_TEAM_ID:?Expected APPLE_TEAM_ID is required}"
: "${COMMANDER_BUILD_NUMBER:?Expected COMMANDER_BUILD_NUMBER is required}"
: "${COMMANDER_GIT_COMMIT:?Expected COMMANDER_GIT_COMMIT is required}"
test -f "$app/Contents/_CodeSignature/CodeResources"
test "$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$app/Contents/Info.plist")" = com.thingtime.Commander
test "$(/usr/bin/plutil -extract CFBundleVersion raw -o - "$app/Contents/Info.plist")" = "$COMMANDER_BUILD_NUMBER"
test "$(/usr/bin/plutil -extract ThingtimeGitCommit raw -o - "$app/Contents/Info.plist")" = "$COMMANDER_GIT_COMMIT"
for relative in Contents/MacOS/Commander Contents/Resources/commander-core Contents/Resources/commander-indexer; do
  test -x "$app/$relative"
  /usr/bin/lipo -verify_arch "$(uname -m)" "$app/$relative"
  /usr/bin/codesign --verify --strict "$app/$relative"
  details="$(/usr/bin/codesign -dvv "$app/$relative" 2>&1)"
  printf '%s\n' "$details" | grep -Fx "TeamIdentifier=$APPLE_TEAM_ID" >/dev/null
  printf '%s\n' "$details" | grep -F 'Authority=Developer ID Application:' >/dev/null
done
# The pinned Node runtime retains the Node.js Foundation signature and JIT
# entitlements. The outer resource seal protects the exact bundled runtime.
test -x "$app/Contents/Resources/node/bin/node"
/usr/bin/lipo -verify_arch "$(uname -m)" "$app/Contents/Resources/node/bin/node"
/usr/bin/codesign --verify --strict "$app/Contents/Resources/node/bin/node"
test -s "$app/Contents/Resources/commander-daemon.mjs"
test -s "$app/Contents/Resources/worker.js"
test -s "$app/Contents/Resources/ui/index.html"
/usr/bin/codesign --verify --deep --strict "$app"
details="$(/usr/bin/codesign -dvv "$app" 2>&1)"
printf '%s\n' "$details" | grep -Fx "TeamIdentifier=$APPLE_TEAM_ID" >/dev/null
printf '%s\n' "$details" | grep -F 'Authority=Developer ID Application:' >/dev/null
/usr/sbin/spctl --assess --type execute --verbose=2 "$app"
/usr/bin/xcrun stapler validate "$app"

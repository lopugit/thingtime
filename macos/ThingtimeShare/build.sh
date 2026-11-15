#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="${1:?Usage: build.sh output-directory}"
GROUP="${THINGTIME_SHARE_APP_GROUP:?Set THINGTIME_SHARE_APP_GROUP}"
IDENTITY="${THINGTIME_SHARE_SIGN_IDENTITY:-}"
TEAM="${THINGTIME_SHARE_TEAM_ID:-}"
if [[ -n "$IDENTITY" && -z "$TEAM" ]]; then echo 'Signed share builds require THINGTIME_SHARE_TEAM_ID' >&2; exit 1; fi
if [[ -n "$IDENTITY" && "$GROUP" != "$TEAM".* ]]; then
  echo 'Direct-distribution sharing requires an App Group prefixed by the signing Team ID.' >&2
  exit 1
fi
mkdir -p "$OUTPUT"
OUTPUT="$(cd "$OUTPUT" && pwd)"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/thingtime-share-build.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
SDK="$(xcrun --sdk macosx --show-sdk-path)"
SHARED=("$ROOT/iOS/ShareSupport/ShareInbox.swift" "$ROOT/iOS/ShareSupport/ShareComposerSession.swift")
for ARCH in arm64 x86_64; do
  xcrun swiftc -swift-version 5 -O -parse-as-library -sdk "$SDK" -target "$ARCH-apple-macosx13.0" -application-extension -Xlinker -e -Xlinker _NSExtensionMain -module-name ThingtimeShare "${SHARED[@]}" "$ROOT/macos/ThingtimeShare/MacShareItemImporter.swift" "$ROOT/macos/ThingtimeShare/ShareViewController.swift" -o "$STAGE/extension-$ARCH"
  xcrun swiftc -swift-version 5 -O -parse-as-library -sdk "$SDK" -target "$ARCH-apple-macosx13.0" "${SHARED[@]}" "$ROOT/macos/ThingtimeShare/ShareBridgeMain.swift" -o "$STAGE/bridge-$ARCH"
done
APPEX="$STAGE/ThingtimeShare.appex"
mkdir -p "$APPEX/Contents/MacOS" "$APPEX/Contents/Resources"
lipo -create "$STAGE/extension-arm64" "$STAGE/extension-x86_64" -output "$APPEX/Contents/MacOS/ThingtimeShare"
lipo -create "$STAGE/bridge-arm64" "$STAGE/bridge-x86_64" -output "$STAGE/ThingtimeShareBridge"
# A dylib can have executable permissions but cannot be launched as an appex.
otool -hv "$APPEX/Contents/MacOS/ThingtimeShare" | awk '$5 == "EXECUTE" {n++} END {exit(n == 2 ? 0 : 1)}'
python3 - "$APPEX/Contents/Info.plist" "$STAGE/extension.entitlements" "$STAGE/helper.entitlements" "$STAGE/thingtime-share.json" "$GROUP" "$TEAM" <<'PY'
import json, plistlib, sys
info, extension, helper, manifest, group, team = sys.argv[1:]
plist = {'CFBundleDevelopmentRegion':'en','CFBundleDisplayName':'Thingtime','CFBundleExecutable':'ThingtimeShare','CFBundleIdentifier':'com.thingtime.desktop.share','CFBundleInfoDictionaryVersion':'6.0','CFBundleName':'ThingtimeShare','CFBundlePackageType':'XPC!','CFBundleShortVersionString':'1.1.0','CFBundleVersion':'1','LSMinimumSystemVersion':'13.0','ThingtimeWidgetGroup':group,'NSExtension':{'NSExtensionPointIdentifier':'com.apple.share-services','NSExtensionPrincipalClass':'ThingtimeMacShareViewController','NSExtensionAttributes':{'NSExtensionActivationRule':'SUBQUERY(extensionItems, $item, $item.attachments.@count > 0 OR $item.attributedContentText.length > 0).@count > 0'}}}
with open(info,'wb') as f: plistlib.dump(plist,f)
for path, bundle, sandbox in [(extension,'com.thingtime.desktop.share',True),(helper,'com.thingtime.desktop.share-bridge',False)]:
    ent = {'com.apple.security.application-groups':[group]}
    if sandbox: ent.update({'com.apple.security.app-sandbox':True,'com.apple.security.files.user-selected.read-only':True})
    # Team-prefixed macOS groups are authorized by the signing certificate.
    # Do not claim profile-backed App ID/Team ID identity entitlements: these
    # standalone/direct-distribution artifacts do not use provisioning profiles.
    # https://developer.apple.com/documentation/xcode/accessing-app-group-containers
    with open(path,'wb') as f: plistlib.dump(ent,f)
with open(manifest,'w') as f: json.dump({'appGroup':group,'version':'1.1.0'},f)
PY
if [[ -n "$IDENTITY" ]]; then
  codesign --force --options runtime --timestamp --sign "$IDENTITY" --entitlements "$STAGE/extension.entitlements" "$APPEX"
  codesign --force --options runtime --timestamp --identifier com.thingtime.desktop.share-bridge --sign "$IDENTITY" --entitlements "$STAGE/helper.entitlements" "$STAGE/ThingtimeShareBridge"
  codesign --verify --deep --strict "$APPEX"
  codesign --verify --strict "$STAGE/ThingtimeShareBridge"
else
  echo 'Building ad-hoc development share artifacts; App Group and installed acceptance remain unverified.' >&2
  codesign --force --timestamp=none --sign - --entitlements "$STAGE/extension.entitlements" "$APPEX"
  codesign --force --timestamp=none --identifier com.thingtime.desktop.share-bridge --sign - --entitlements "$STAGE/helper.entitlements" "$STAGE/ThingtimeShareBridge"
fi
# Replace only the three explicitly owned output artifacts after both builds pass.
rm -rf "$OUTPUT/ThingtimeShare.appex"
ditto "$APPEX" "$OUTPUT/ThingtimeShare.appex"
ditto "$STAGE/ThingtimeShareBridge" "$OUTPUT/ThingtimeShareBridge"
cp "$STAGE/thingtime-share.json" "$OUTPUT/thingtime-share.json"
echo "Built native share artifacts in $OUTPUT"

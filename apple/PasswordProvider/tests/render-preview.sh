#!/bin/bash
# Render the actual provider SwiftUI with synthetic state, without a provider
# controller, vault connection, authentication, entitlements or OS registration.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PREVIEW_DIR="${TMPDIR:-/tmp}/thingtime-provider-ui-preview"
mkdir -p "$PREVIEW_DIR"
swift build --package-path "$ROOT/apple/Passwords" >/dev/null
CORE_BUILD="$(swift build --package-path "$ROOT/apple/Passwords" --show-bin-path)"
cat "$ROOT/apple/PasswordProvider/CredentialProviderViewController.swift" "$ROOT/apple/PasswordProvider/tests/render-preview.swift" > "$PREVIEW_DIR/ProviderPreview.swift"
PREVIEW_APP="$PREVIEW_DIR/ThingtimeProviderPreview.app"
mkdir -p "$PREVIEW_APP/Contents/MacOS"
cat > "$PREVIEW_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.thingtime.passwords.synthetic-preview</string>
<key>CFBundleExecutable</key><string>ThingtimeProviderPreview</string>
<key>CFBundleName</key><string>Thingtime provider preview</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
PLIST
if test -f "$CORE_BUILD/libThingtimePasswordCore.a"; then
    swiftc -parse-as-library -I "$CORE_BUILD" "$PREVIEW_DIR/ProviderPreview.swift" "$CORE_BUILD/libThingtimePasswordCore.a" -o "$PREVIEW_APP/Contents/MacOS/ThingtimeProviderPreview"
else
    swiftc -parse-as-library -I "$CORE_BUILD/Modules" "$PREVIEW_DIR/ProviderPreview.swift" "$CORE_BUILD"/ThingtimePasswordCore.build/*.swift.o -o "$PREVIEW_APP/Contents/MacOS/ThingtimeProviderPreview"
fi
exec "$PREVIEW_APP/Contents/MacOS/ThingtimeProviderPreview" "$@"

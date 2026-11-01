#!/usr/bin/env bash
set -euo pipefail

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$script_root/.." && pwd)"
: "${COMMANDER_RELEASE_VERSION:?COMMANDER_RELEASE_VERSION is required}"
: "${COMMANDER_BUILD_NUMBER:?COMMANDER_BUILD_NUMBER is required}"
: "${COMMANDER_GIT_COMMIT:?COMMANDER_GIT_COMMIT is required}"
: "${APPLE_API_KEY:?APPLE_API_KEY is required}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"
[[ "$COMMANDER_RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+\+build\.[0-9]+\.g[0-9a-f]{12}$ ]]
[[ "$COMMANDER_GIT_COMMIT" =~ ^[0-9a-f]{40}$ ]]
test "$COMMANDER_RELEASE_VERSION" = "$(node "$script_root/release-version.mjs" check)+build.${COMMANDER_BUILD_NUMBER}.g${COMMANDER_GIT_COMMIT:0:12}"
case "${COMMANDER_SIGNING_IDENTITY:-}" in
  "Developer ID Application:"*) ;;
  *) echo 'A Developer ID Application identity is required.' >&2; exit 2 ;;
esac

# --prepare must have passed on this exact checkout before CI imports secrets.
COMMANDER_SIGNING_MODE=distribution COMMANDER_NOTARIZATION_MODE=external \
  "$script_root/build_and_run.sh" --package-only
app="$root/dist/Commander.app"
release_root="$root/release"
mkdir -p "$release_root"
work="$(mktemp -d "${TMPDIR:-/tmp}/commander-release.XXXXXX")"
trap '/bin/rm -rf -- "$work"' EXIT
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app" "$work/notary.zip"
/usr/bin/xcrun notarytool submit "$work/notary.zip" --wait \
  --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER"
/usr/bin/xcrun stapler staple "$app"
"$script_root/verify-production-bundle.sh" "$app"
archive="$release_root/Commander-App-Release-${COMMANDER_RELEASE_VERSION}-macos-$(uname -m).zip"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
/usr/bin/ditto -x -k "$archive" "$work/extracted"
"$script_root/verify-production-bundle.sh" "$work/extracted/Commander.app"
echo "$archive"

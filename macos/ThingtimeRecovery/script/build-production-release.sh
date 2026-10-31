#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
CACHE_ROOT="${THINGTIME_RECOVERY_CACHE_ROOT:-${HOME}/Library/Caches/com.thingtime.desktop.recovery}"
APP_PATH="${CACHE_ROOT}/bundle-stage/Thingtime Recovery.app"
RELEASE_VERSION="${THINGTIME_RECOVERY_VERSION:?THINGTIME_RECOVERY_VERSION is required}"
RELEASE_ROOT="${PACKAGE_ROOT}/release"
NOTARY_ARCHIVE="${RELEASE_ROOT}/Thingtime-Recovery-notary-${RELEASE_VERSION}.zip"
FINAL_ARCHIVE="${RELEASE_ROOT}/Thingtime-Recovery-App-Release-${RELEASE_VERSION}-macos-$(uname -m).zip"
ARCHIVE_VERIFY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/thingtime-recovery-archive-verify.XXXXXX")"
trap '/bin/rm -rf -- "${ARCHIVE_VERIFY_ROOT}"' EXIT

case "${THINGTIME_RECOVERY_SIGNING_IDENTITY:-}" in
    "Developer ID Application:"*) ;;
    *) echo "THINGTIME_RECOVERY_SIGNING_IDENTITY must name an imported Developer ID Application identity." >&2; exit 2 ;;
esac
: "${APPLE_API_KEY:?APPLE_API_KEY is required for recovery notarization}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required for recovery notarization}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required for recovery notarization}"

"${SCRIPT_DIR}/build-bundle.sh"
test -d "${APP_PATH}"
rm -rf -- "${RELEASE_ROOT}"
mkdir -p "${RELEASE_ROOT}"
/usr/bin/ditto -c -k --keepParent "${APP_PATH}" "${NOTARY_ARCHIVE}"
/usr/bin/xcrun notarytool submit "${NOTARY_ARCHIVE}" \
    --key "${APPLE_API_KEY}" \
    --key-id "${APPLE_API_KEY_ID}" \
    --issuer "${APPLE_API_ISSUER}" \
    --wait
/usr/bin/xcrun stapler staple "${APP_PATH}"
"${SCRIPT_DIR}/verify-production-bundle.sh" "${APP_PATH}"
/usr/bin/ditto -c -k --keepParent "${APP_PATH}" "${FINAL_ARCHIVE}"
/usr/bin/ditto -x -k "${FINAL_ARCHIVE}" "${ARCHIVE_VERIFY_ROOT}"
"${SCRIPT_DIR}/verify-production-bundle.sh" "${ARCHIVE_VERIFY_ROOT}/Thingtime Recovery.app"
rm -f -- "${NOTARY_ARCHIVE}"
echo "${FINAL_ARCHIVE}"

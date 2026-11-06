#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
CACHE_ROOT="${THINGTIME_RECOVERY_CACHE_ROOT:-${HOME}/Library/Caches/com.thingtime.desktop.recovery}"
APP_PATH="${CACHE_ROOT}/bundle-stage/Thingtime Recovery.app"
RELEASE_VERSION="${THINGTIME_RECOVERY_VERSION:?THINGTIME_RECOVERY_VERSION is required}"
RELEASE_ROOT="${PACKAGE_ROOT}/release"
FINAL_ARCHIVE="${RELEASE_ROOT}/Thingtime-Recovery-App-UNSIGNED-Release-${RELEASE_VERSION}-macos-$(uname -m).zip"
ARCHIVE_VERIFY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/thingtime-recovery-archive-verify.XXXXXX")"
trap '/bin/rm -rf -- "${ARCHIVE_VERIFY_ROOT}"' EXIT

case "${RELEASE_VERSION}" in
    *.unsigned) ;;
    *) echo "Unsigned Recovery releases must use a SemVer version ending in .unsigned." >&2; exit 2 ;;
esac
unset THINGTIME_RECOVERY_SIGNING_IDENTITY THINGTIME_ELECTRON_SIGNING_IDENTITY
THINGTIME_RECOVERY_SIGNING_MODE=unsigned "${SCRIPT_DIR}/build-bundle.sh"
test -d "${APP_PATH}"
rm -rf -- "${RELEASE_ROOT}"
mkdir -p "${RELEASE_ROOT}"
"${SCRIPT_DIR}/verify-unsigned-bundle.sh" "${APP_PATH}"
/usr/bin/ditto -c -k --keepParent "${APP_PATH}" "${FINAL_ARCHIVE}"
/usr/bin/ditto -x -k "${FINAL_ARCHIVE}" "${ARCHIVE_VERIFY_ROOT}"
"${SCRIPT_DIR}/verify-unsigned-bundle.sh" "${ARCHIVE_VERIFY_ROOT}/Thingtime Recovery.app"
echo "${FINAL_ARCHIVE}"

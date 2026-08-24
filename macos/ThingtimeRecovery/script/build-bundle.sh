#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
CACHE_ROOT="${THINGTIME_RECOVERY_CACHE_ROOT:-${HOME}/Library/Caches/com.thingtime.desktop.recovery}"
SWIFT_SCRATCH="${CACHE_ROOT}/swiftpm-release"
STAGE_ROOT="${CACHE_ROOT}/bundle-stage"
APP_PATH="${STAGE_ROOT}/Thingtime Recovery.app"
CONTENTS_PATH="${APP_PATH}/Contents"
VERSION="${THINGTIME_RECOVERY_VERSION:-0.1.0}"
BUILD_NUMBER="${THINGTIME_RECOVERY_BUILD_NUMBER:-1}"
SIGNING_MODE="${THINGTIME_RECOVERY_SIGNING_MODE:-signed}"

case "${CACHE_ROOT}" in
    "${HOME}/Library/Caches/com.thingtime.desktop.recovery"*) ;;
    *) echo "THINGTIME_RECOVERY_CACHE_ROOT must stay under ~/Library/Caches/com.thingtime.desktop.recovery" >&2; exit 2 ;;
esac

swift build --package-path "${PACKAGE_ROOT}" --scratch-path "${SWIFT_SCRATCH}" --configuration release --product ThingtimeRecovery
swift build --package-path "${PACKAGE_ROOT}" --scratch-path "${SWIFT_SCRATCH}" --configuration release --product ThingtimeRecoveryInstaller

BIN_DIRECTORY="$(swift build --package-path "${PACKAGE_ROOT}" --scratch-path "${SWIFT_SCRATCH}" --configuration release --show-bin-path)"
APP_EXECUTABLE="${BIN_DIRECTORY}/ThingtimeRecovery"
INSTALLER_EXECUTABLE="${BIN_DIRECTORY}/ThingtimeRecoveryInstaller"
ICON_SOURCE="${PACKAGE_ROOT}/../ThingtimeNode/Resources/ThingtimeNodeIcon.png"

test -x "${APP_EXECUTABLE}"
test -x "${INSTALLER_EXECUTABLE}"
test -f "${ICON_SOURCE}"
mkdir -p "${STAGE_ROOT}"
if [[ -e "${APP_PATH}" ]]; then rm -rf -- "${APP_PATH}"; fi
mkdir -p "${CONTENTS_PATH}/MacOS" "${CONTENTS_PATH}/Helpers" "${CONTENTS_PATH}/Resources"
/usr/bin/ditto "${APP_EXECUTABLE}" "${CONTENTS_PATH}/MacOS/ThingtimeRecovery"
/usr/bin/ditto "${INSTALLER_EXECUTABLE}" "${CONTENTS_PATH}/Helpers/ThingtimeRecoveryInstaller"
/usr/bin/ditto "${PACKAGE_ROOT}/Resources/Info.plist" "${CONTENTS_PATH}/Info.plist"

ICON_WORK_ROOT="$(mktemp -d "${CACHE_ROOT}/icon-build.XXXXXX")"
trap '/bin/rm -rf -- "${ICON_WORK_ROOT}"' EXIT
ICONSET_PATH="${ICON_WORK_ROOT}/ThingtimeRecovery.iconset"
mkdir -p "${ICONSET_PATH}"
while read -r filename size; do
    /usr/bin/sips -z "${size}" "${size}" "${ICON_SOURCE}" --out "${ICONSET_PATH}/${filename}" >/dev/null
done <<'ICON_SIZES'
icon_16x16.png 16
icon_16x16@2x.png 32
icon_32x32.png 32
icon_32x32@2x.png 64
icon_128x128.png 128
icon_128x128@2x.png 256
icon_256x256.png 256
icon_256x256@2x.png 512
icon_512x512.png 512
icon_512x512@2x.png 1024
ICON_SIZES
/usr/bin/iconutil -c icns "${ICONSET_PATH}" --output "${CONTENTS_PATH}/Resources/ThingtimeRecovery.icns"
/usr/bin/plutil -replace CFBundleShortVersionString -string "${VERSION}" "${CONTENTS_PATH}/Info.plist"
/usr/bin/plutil -replace CFBundleVersion -string "${BUILD_NUMBER}" "${CONTENTS_PATH}/Info.plist"
/usr/bin/xattr -cr "${APP_PATH}"

case "${SIGNING_MODE}" in
    signed)
        SIGNING_IDENTITY="${THINGTIME_RECOVERY_SIGNING_IDENTITY:-${THINGTIME_ELECTRON_SIGNING_IDENTITY:-}}"
        if [[ -z "${SIGNING_IDENTITY}" ]]; then
            SIGNING_IDENTITY="$(security find-identity -v -p codesigning | awk -F '"' '/Apple Development:/ { print $2; exit }')"
        fi
        case "${SIGNING_IDENTITY}" in
            "Apple Development:"*) TIMESTAMP_ARGUMENT="--timestamp=none" ;;
            "Developer ID Application:"*) TIMESTAMP_ARGUMENT="--timestamp" ;;
            "") echo "No Apple Development identity is available. Set THINGTIME_RECOVERY_SIGNING_IDENTITY." >&2; exit 3 ;;
            *) echo "THINGTIME_RECOVERY_SIGNING_IDENTITY must be Apple Development or Developer ID Application." >&2; exit 3 ;;
        esac
        /usr/bin/codesign --force --sign "${SIGNING_IDENTITY}" --identifier com.thingtime.desktop.recovery.installer --options runtime "${TIMESTAMP_ARGUMENT}" "${CONTENTS_PATH}/Helpers/ThingtimeRecoveryInstaller"
        /usr/bin/codesign --force --sign "${SIGNING_IDENTITY}" --identifier com.thingtime.desktop.recovery --options runtime "${TIMESTAMP_ARGUMENT}" --entitlements "${PACKAGE_ROOT}/Resources/ThingtimeRecovery.entitlements" "${APP_PATH}"
        ;;
    unsigned)
        if [[ -n "${THINGTIME_RECOVERY_SIGNING_IDENTITY:-}" || -n "${THINGTIME_ELECTRON_SIGNING_IDENTITY:-}" ]]; then
            echo "Unsigned recovery builds must not receive an Apple signing identity." >&2
            exit 3
        fi
        # Ad-hoc signatures keep nested macOS code structurally executable but
        # provide no Developer ID identity, notarization, or updater trust.
        /usr/bin/codesign --force --sign - --identifier com.thingtime.desktop.recovery.installer --options runtime --timestamp=none "${CONTENTS_PATH}/Helpers/ThingtimeRecoveryInstaller"
        /usr/bin/codesign --force --sign - --identifier com.thingtime.desktop.recovery --options runtime --timestamp=none --entitlements "${PACKAGE_ROOT}/Resources/ThingtimeRecovery.entitlements" "${APP_PATH}"
        ;;
    *)
        echo "THINGTIME_RECOVERY_SIGNING_MODE must be signed or unsigned." >&2
        exit 3
        ;;
esac
/usr/bin/codesign --verify --deep --strict --verbose=2 "${APP_PATH}"
/usr/bin/codesign -dr - "${APP_PATH}" 2>&1
echo "${APP_PATH}"

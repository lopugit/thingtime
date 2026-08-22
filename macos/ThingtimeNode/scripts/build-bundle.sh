#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
CACHE_ROOT="${THINGTIME_NODE_CACHE_ROOT:-${HOME}/Library/Caches/com.thingtime.desktop.node}"
SWIFT_SCRATCH="${CACHE_ROOT}/swiftpm-release"
STAGE_ROOT="${CACHE_ROOT}/bundle-stage"
APP_PATH="${STAGE_ROOT}/Thingtime Node.app"
CONTENTS_PATH="${APP_PATH}/Contents"
VERSION="${THINGTIME_NODE_VERSION:-0.1.0}"
BUILD_NUMBER="${THINGTIME_NODE_BUILD_NUMBER:-1}"

case "${CACHE_ROOT}" in
    "${HOME}/Library/Caches/com.thingtime.desktop.node"*) ;;
    *)
        echo "THINGTIME_NODE_CACHE_ROOT must stay under ~/Library/Caches/com.thingtime.desktop.node" >&2
        exit 2
        ;;
esac

swift build \
    --package-path "${PACKAGE_ROOT}" \
    --scratch-path "${SWIFT_SCRATCH}" \
    --configuration release

BIN_PATH="$(swift build \
    --package-path "${PACKAGE_ROOT}" \
    --scratch-path "${SWIFT_SCRATCH}" \
    --configuration release \
    --show-bin-path)/ThingtimeNode"
BRIDGE_PATH="$(dirname "${BIN_PATH}")/ThingtimeNodeBridge"
RESOURCE_BUNDLE_PATH="$(dirname "${BIN_PATH}")/ThingtimeNode_ThingtimeNodeCore.bundle"

test -x "${BIN_PATH}"
test -x "${BRIDGE_PATH}"
test -d "${RESOURCE_BUNDLE_PATH}"
mkdir -p "${STAGE_ROOT}"
if [[ -e "${APP_PATH}" ]]; then
    rm -rf -- "${APP_PATH}"
fi
mkdir -p "${CONTENTS_PATH}/MacOS"
mkdir -p "${CONTENTS_PATH}/Resources"
/usr/bin/ditto "${BIN_PATH}" "${CONTENTS_PATH}/MacOS/ThingtimeNode"
/usr/bin/ditto "${BRIDGE_PATH}" "${CONTENTS_PATH}/MacOS/ThingtimeNodeBridge"
/usr/bin/ditto "${RESOURCE_BUNDLE_PATH}" "${CONTENTS_PATH}/Resources/ThingtimeNode_ThingtimeNodeCore.bundle"
/usr/bin/ditto "${PACKAGE_ROOT}/Resources/Info.plist" "${CONTENTS_PATH}/Info.plist"
if [[ "${THINGTIME_NODE_EMBEDDED:-0}" != "1" ]]; then
    mkdir -p "${CONTENTS_PATH}/Library/LaunchAgents"
    /usr/bin/ditto \
        "${PACKAGE_ROOT}/Resources/com.thingtime.desktop.node.plist" \
        "${CONTENTS_PATH}/Library/LaunchAgents/com.thingtime.desktop.node.plist"
fi
/usr/bin/plutil -replace CFBundleShortVersionString -string "${VERSION}" "${CONTENTS_PATH}/Info.plist"
/usr/bin/plutil -replace CFBundleVersion -string "${BUILD_NUMBER}" "${CONTENTS_PATH}/Info.plist"
if [[ "${THINGTIME_NODE_EMBEDDED:-0}" == "1" ]]; then
    /usr/bin/plutil -replace ThingtimeNodeElectronManaged -bool true "${CONTENTS_PATH}/Info.plist"
fi
/usr/bin/xattr -cr "${APP_PATH}"

SIGNING_IDENTITY="${THINGTIME_NODE_SIGNING_IDENTITY:-}"
if [[ -z "${SIGNING_IDENTITY}" ]]; then
    SIGNING_IDENTITY="$(security find-identity -v -p codesigning \
        | awk -F '"' '/Apple Development:/ { print $2; exit }')"
fi
case "${SIGNING_IDENTITY}" in
    "Apple Development:"*)
        TIMESTAMP_ARGUMENT="--timestamp=none"
        ;;
    "Developer ID Application:"*)
        TIMESTAMP_ARGUMENT="--timestamp"
        ;;
    "")
        echo "No Apple Development identity is available. Set THINGTIME_NODE_SIGNING_IDENTITY." >&2
        exit 3
        ;;
    *)
        echo "THINGTIME_NODE_SIGNING_IDENTITY must be Apple Development or Developer ID Application." >&2
        exit 3
        ;;
esac

/usr/bin/codesign \
    --force \
    --sign "${SIGNING_IDENTITY}" \
    --identifier com.thingtime.desktop.node.bridge \
    --options runtime \
    "${TIMESTAMP_ARGUMENT}" \
    "${CONTENTS_PATH}/MacOS/ThingtimeNodeBridge"

/usr/bin/codesign \
    --force \
    --sign "${SIGNING_IDENTITY}" \
    --options runtime \
    "${TIMESTAMP_ARGUMENT}" \
    --entitlements "${PACKAGE_ROOT}/Resources/ThingtimeNode.entitlements" \
    "${APP_PATH}"
/usr/bin/codesign --verify --deep --strict --verbose=2 "${APP_PATH}"
/usr/bin/codesign -dr - "${APP_PATH}" 2>&1
echo "${APP_PATH}"

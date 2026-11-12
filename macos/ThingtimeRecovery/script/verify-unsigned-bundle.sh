#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:?usage: verify-unsigned-bundle.sh <Thingtime Recovery.app>}"
test -d "${APP_PATH}"
test -x "${APP_PATH}/Contents/MacOS/ThingtimeRecovery"
test -x "${APP_PATH}/Contents/Helpers/ThingtimeRecoveryInstaller"
/usr/bin/codesign --verify --deep --strict --verbose=2 "${APP_PATH}"
DETAILS="$(/usr/bin/codesign --display --verbose=4 "${APP_PATH}" 2>&1)"
printf '%s\n' "${DETAILS}" | grep -F 'Identifier=com.thingtime.desktop.recovery' >/dev/null
printf '%s\n' "${DETAILS}" | grep -F 'TeamIdentifier=not set' >/dev/null
if printf '%s\n' "${DETAILS}" | grep -Eq 'Authority=(Apple Development|Developer ID Application):'; then
    echo "A trusted Apple-signed recovery bundle must not be published as unsigned." >&2
    exit 1
fi

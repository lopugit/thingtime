#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:?usage: verify-production-bundle.sh <Thingtime Recovery.app>}"
test -d "${APP_PATH}"
/usr/bin/codesign --verify --deep --strict --verbose=2 "${APP_PATH}"
DETAILS="$(/usr/bin/codesign --display --verbose=4 "${APP_PATH}" 2>&1)"
printf '%s\n' "${DETAILS}" | grep -F 'Identifier=com.thingtime.desktop.recovery' >/dev/null
printf '%s\n' "${DETAILS}" | grep -F 'Authority=Developer ID Application:' >/dev/null
/usr/sbin/spctl --assess --type execute --verbose=2 "${APP_PATH}"
/usr/bin/xcrun stapler validate "${APP_PATH}"

#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEV_ROOT="${HOME}/Library/Caches/com.thingtime.desktop.recovery/development-stage"
APP="${DEV_ROOT}/Thingtime Recovery Dev.app"
if [[ "${1:-}" == "stop" ]]; then
    # Target the isolated bundle identity, never the installed Recovery process.
    /usr/bin/osascript -e 'tell application id "com.thingtime.desktop.recovery.dev" to quit' 2>/dev/null || true
    exit 0
fi
THINGTIME_RECOVERY_SIGNING_MODE=development "${SCRIPT_DIR}/build-bundle.sh"
mkdir -p "${DEV_ROOT}/home/.codex" "${DEV_ROOT}/home/.cursor" "${DEV_ROOT}/home/.gemini"
/usr/bin/open -n "${APP}" --env "THINGTIME_RECOVERY_INTEGRATION_HOME=${DEV_ROOT}/home"
echo "Development app: ${APP}"
echo "Isolated integration home: ${DEV_ROOT}/home"

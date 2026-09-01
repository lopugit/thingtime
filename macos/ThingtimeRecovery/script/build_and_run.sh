#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CACHE_ROOT="${THINGTIME_RECOVERY_CACHE_ROOT:-${HOME}/Library/Caches/com.thingtime.desktop.recovery}"
SOURCE_APP="${CACHE_ROOT}/bundle-stage/Thingtime Recovery.app"
INSTALL_ROOT="${HOME}/Applications"
INSTALLED_APP="${INSTALL_ROOT}/Thingtime Recovery.app"
INSTALLED_EXECUTABLE="${INSTALLED_APP}/Contents/MacOS/ThingtimeRecovery"
INSTALL_TOKEN="$(uuidgen)"
STAGED_INSTALL="${INSTALL_ROOT}/.thingtime-recovery-install-${INSTALL_TOKEN}.app"
PREVIOUS_INSTALL="${INSTALL_ROOT}/.thingtime-recovery-previous-${INSTALL_TOKEN}.app"
TRASH_ROOT="${HOME}/.Trash"

if pgrep -x ThingtimeRecovery >/dev/null 2>&1; then
    pkill -TERM -x ThingtimeRecovery || true
    for _ in {1..20}; do
        pgrep -x ThingtimeRecovery >/dev/null 2>&1 || break
        sleep 0.25
    done
fi
if pgrep -x ThingtimeRecovery >/dev/null 2>&1; then
    echo "Existing Thingtime Recovery process did not terminate; installation was left unchanged." >&2
    exit 4
fi

"${SCRIPT_DIR}/build-bundle.sh"
test -x "${SOURCE_APP}/Contents/MacOS/ThingtimeRecovery"
/usr/bin/codesign --verify --deep --strict --verbose=2 "${SOURCE_APP}"
mkdir -p "${INSTALL_ROOT}"
cleanup_failed_install() {
    if [[ -e "${PREVIOUS_INSTALL}" ]]; then
        if [[ -e "${INSTALLED_APP}" ]]; then
            mkdir -p "${TRASH_ROOT}"
            mv "${INSTALLED_APP}" "${TRASH_ROOT}/ThingtimeRecovery-invalid-${INSTALL_TOKEN}.app"
        fi
        mv "${PREVIOUS_INSTALL}" "${INSTALLED_APP}"
    fi
    if [[ -e "${STAGED_INSTALL}" ]]; then mkdir -p "${TRASH_ROOT}"; mv "${STAGED_INSTALL}" "${TRASH_ROOT}/ThingtimeRecovery-incomplete-${INSTALL_TOKEN}.app"; fi
}
trap cleanup_failed_install ERR
/usr/bin/ditto "${SOURCE_APP}" "${STAGED_INSTALL}"
/usr/bin/codesign --verify --deep --strict --verbose=2 "${STAGED_INSTALL}"
if [[ -e "${INSTALLED_APP}" ]]; then mv "${INSTALLED_APP}" "${PREVIOUS_INSTALL}"; fi
mv "${STAGED_INSTALL}" "${INSTALLED_APP}"
/usr/bin/codesign --verify --deep --strict --verbose=2 "${INSTALLED_APP}"
test -x "${INSTALLED_EXECUTABLE}"
trap - ERR
if [[ -e "${PREVIOUS_INSTALL}" ]]; then
    mkdir -p "${TRASH_ROOT}"
    mv "${PREVIOUS_INSTALL}" "${TRASH_ROOT}/ThingtimeRecovery-previous-${INSTALL_TOKEN}.app"
fi

open_app() {
    /usr/bin/open -n "${INSTALLED_APP}" >/dev/null 2>&1 &
    local launcher_pid=$!
    for _ in {1..20}; do
        pgrep -x ThingtimeRecovery >/dev/null 2>&1 && break
        sleep 0.25
    done
    # `open` normally returns immediately, but some macOS releases keep its
    # launcher process alive until the GUI exits. The app has already been
    # handed to LaunchServices, so do not let a local Run action hang on it.
    if kill -0 "${launcher_pid}" 2>/dev/null; then kill -TERM "${launcher_pid}" || true; fi
}
case "${MODE}" in
    run) open_app ;;
    --debug|debug) lldb -- "${INSTALLED_EXECUTABLE}" ;;
    --logs|logs) open_app; /usr/bin/log stream --info --style compact --predicate 'process == "ThingtimeRecovery"' ;;
    --telemetry|telemetry) open_app; /usr/bin/log stream --info --style compact --predicate 'subsystem == "com.thingtime.desktop.recovery"' ;;
    --verify|verify)
        open_app
        for _ in {1..20}; do
            pgrep -x ThingtimeRecovery >/dev/null 2>&1 && break
            sleep 0.25
        done
        pgrep -x ThingtimeRecovery >/dev/null
        ;;
    *) echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2; exit 2 ;;
esac

echo "Built: ${SOURCE_APP}"
echo "Installed: ${INSTALLED_APP}"
echo "Executable: ${INSTALLED_EXECUTABLE}"

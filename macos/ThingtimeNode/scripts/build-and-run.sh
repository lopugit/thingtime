#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CACHE_ROOT="${THINGTIME_NODE_CACHE_ROOT:-${HOME}/Library/Caches/com.thingtime.desktop.node}"
SOURCE_APP="${CACHE_ROOT}/bundle-stage/Thingtime Node.app"
INSTALL_ROOT="${HOME}/Applications"
INSTALLED_APP="${INSTALL_ROOT}/Thingtime Node.app"
INSTALLED_EXECUTABLE="${INSTALLED_APP}/Contents/MacOS/ThingtimeNode"

"${SCRIPT_DIR}/build-bundle.sh"
test -x "${SOURCE_APP}/Contents/MacOS/ThingtimeNode"
/usr/bin/codesign --verify --deep --strict --verbose=2 "${SOURCE_APP}"

running_pids=()
while IFS= read -r candidate_pid; do
    [[ -n "${candidate_pid}" ]] || continue
    candidate_command="$(ps -p "${candidate_pid}" -o command= 2>/dev/null || true)"
    if [[ "${candidate_command}" == "${INSTALLED_EXECUTABLE}" ]]; then
        running_pids+=("${candidate_pid}")
    fi
done < <(pgrep -x ThingtimeNode 2>/dev/null || true)

for running_pid in "${running_pids[@]}"; do
    kill -TERM "${running_pid}"
done
for _ in {1..20}; do
    still_running=false
    for running_pid in "${running_pids[@]}"; do
        if kill -0 "${running_pid}" 2>/dev/null; then
            still_running=true
        fi
    done
    [[ "${still_running}" == false ]] && break
    sleep 0.25
done
for running_pid in "${running_pids[@]}"; do
    if kill -0 "${running_pid}" 2>/dev/null; then
        echo "Existing Thingtime Node process ${running_pid} did not terminate; installation was not replaced." >&2
        exit 4
    fi
done

mkdir -p "${INSTALL_ROOT}"
/usr/bin/ditto "${SOURCE_APP}" "${INSTALLED_APP}"
/usr/bin/codesign --verify --deep --strict --verbose=2 "${INSTALLED_APP}"
test -x "${INSTALLED_EXECUTABLE}"

/usr/bin/open "${INSTALLED_APP}"
for _ in {1..20}; do
    if pgrep -f "${INSTALLED_EXECUTABLE}" >/dev/null 2>&1; then
        break
    fi
    sleep 0.25
done
if ! pgrep -f "${INSTALLED_EXECUTABLE}" >/dev/null 2>&1; then
    echo "The installed Thingtime Node executable did not stay running." >&2
    exit 5
fi

echo "Built: ${SOURCE_APP}"
echo "Installed: ${INSTALLED_APP}"
echo "Executable: ${INSTALLED_EXECUTABLE}"

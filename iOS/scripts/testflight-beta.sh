#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${IOS_DIR}/.env"

cd "${IOS_DIR}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ENV_FILE}"
  set +a
fi

if [[ -n "${THINGTIME_WEB_URL:-}" ]]; then
  echo "Thingtime web URL: ${THINGTIME_WEB_URL}"
else
  echo "Thingtime web URL: https://thingtime.com (default)"
fi

bundle exec fastlane beta

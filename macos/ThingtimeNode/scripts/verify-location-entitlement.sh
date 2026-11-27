#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
    echo "Usage: verify-location-entitlement.sh <signed-node-app>" >&2
    exit 2
fi

LOCATION_ENTITLEMENT="$(/usr/bin/codesign --display --entitlements - --xml "$1" \
    | /usr/bin/plutil -extract 'com\.apple\.security\.personal-information\.location' raw -expect bool -o - -)"
if [[ "${LOCATION_ENTITLEMENT}" != "true" ]]; then
    echo "Thingtime Node is missing its enabled location entitlement." >&2
    exit 3
fi

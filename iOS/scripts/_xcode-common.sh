#!/usr/bin/env bash
# Shared xcodebuild settings for the native Thingtime iOS helper scripts.

PROJECT="Thingtime.xcodeproj"
SCHEME="Thingtime"

if [ ! -d "$PROJECT" ]; then
  echo "error: $PROJECT not found. Run ./scripts/bootstrap.sh or 'xcodegen generate' first." >&2
  exit 1
fi

if [ -z "${DEST:-}" ]; then
  DEST="${1:-generic/platform=iOS Simulator}"
fi

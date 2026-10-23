#!/usr/bin/env bash
# One-step setup: installs XcodeGen if needed, generates the Xcode project, and opens it.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v xcodegen >/dev/null; then
  if ! command -v brew >/dev/null; then
    echo "Homebrew not found. Install from https://brew.sh, then re-run this script." >&2
    exit 1
  fi
  brew install xcodegen
fi

xcodegen generate
open Thingtime.xcodeproj

cat <<'EOF'

Next steps:
  - Select the Thingtime scheme in Xcode.
  - Set your signing team if Xcode asks for one.
  - Press Cmd+R to run the native web-view app.

Useful commands:
  ./scripts/build.sh
  ./scripts/test.sh
EOF

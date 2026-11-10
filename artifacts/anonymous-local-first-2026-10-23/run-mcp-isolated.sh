#!/bin/bash
set -euo pipefail
repo=/workspace/thingtime
output="$repo/artifacts/anonymous-local-first-2026-10-23"
runtime=/opt/codex/runtimes/codex-primary-runtime/dependencies/node
exec bwrap --unshare-all --die-with-parent --new-session \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --ro-bind "$runtime" "$runtime" \
  --ro-bind /etc/fonts /etc/fonts \
  --ro-bind /etc/passwd /etc/passwd --ro-bind /etc/group /etc/group \
  --dev /dev --proc /proc --tmpfs /tmp \
  --dir /home/agent \
  --ro-bind /home/agent/.cache/ms-playwright /home/agent/.cache/ms-playwright \
  --ro-bind "$repo/MCP/dist" "$repo/MCP/dist" \
  --ro-bind "$repo/MCP/node_modules" "$repo/MCP/node_modules" \
  --ro-bind "$repo/MCP/package.json" "$repo/MCP/package.json" \
  --ro-bind "$repo/MCP/test" "$repo/MCP/test" \
  --ro-bind "$repo/MCP/scripts/render-example.mjs" "$repo/MCP/scripts/render-example.mjs" \
  --ro-bind /tmp/thingtime-draft-build-20261023 "$repo/remix/dist/draft-preview" \
  --bind "$output" "$output" \
  --clearenv --setenv HOME /home/agent \
  --setenv PATH "$runtime/bin:/usr/bin:/bin" \
  --setenv PLAYWRIGHT_BROWSERS_PATH /home/agent/.cache/ms-playwright \
  --setenv TT_DRAFT_BROWSER_TEST 1 --setenv TT_DRAFT_ARTIFACT_DIR "$output" \
  --chdir "$repo/MCP" -- "$@"

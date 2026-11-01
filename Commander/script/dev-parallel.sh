#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="$(printf '%s' "$ROOT" | shasum -a 256 | cut -c1-12)"
DEV_ROOT="$HOME/Library/Caches/com.thingtime.Commander.development/$KEY"
APP="$DEV_ROOT/Commander Development.app"
EXECUTABLE="$APP/Contents/MacOS/CommanderDevelopment"
KEY_PREFIX="${KEY:0:4}"
PORT="$((49000 + 16#$KEY_PREFIX % 1000))"
MODE="${1:-build}"
PID_FILE="$DEV_ROOT/host.pid"

host_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  [[ "$(ps -p "$pid" -o comm= 2>/dev/null)" == "$EXECUTABLE" ]] || return 1
  printf '%s' "$pid"
}
stop() {
  local pid
  if pid="$(host_pid)"; then
    kill -TERM "$pid"
    for _ in {1..50}; do
      if ! kill -0 "$pid" 2>/dev/null; then break; fi
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "Development host has not exited; preserving its files." >&2
      exit 1
    fi
  fi
  rm -f "$PID_FILE"
  # The daemon watches its native parent. Wait for that owned runtime to exit.
  for _ in {1..50}; do
    if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then return; fi
    sleep 0.1
  done
  echo "Development port remains occupied; preserving runtime files." >&2
  exit 1
}

case "$MODE" in
  stop) stop; exit ;;
  clean) stop; rm -rf -- "$DEV_ROOT"; exit ;;
  status)
    if pid="$(host_pid)"; then printf 'Host PID: %s\n' "$pid"; fi
    printf 'App: %s\nFixtures: %s\nURL: http://127.0.0.1:%s\n' "$APP" "$DEV_ROOT/fixtures" "$PORT"
    curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:$PORT/healthz"
    exit ;;
  build|package|start) ;;
  *) echo "Usage: $0 {build|package|start|status|stop|clean}" >&2; exit 2 ;;
esac

if [[ "$MODE" != start ]]; then
  if host_pid >/dev/null; then echo 'Stop the development host before rebuilding.' >&2; exit 1; fi
  if [[ "$MODE" == build ]]; then
    corepack pnpm --dir "$ROOT" build
    cargo build --locked --manifest-path "$ROOT/crates/commander-core/Cargo.toml"
    cargo build --locked --manifest-path "$ROOT/crates/commander-indexer/Cargo.toml"
    swift build --package-path "$ROOT/hosts/macos"
  fi
  SWIFT_BIN="$(swift build --package-path "$ROOT/hosts/macos" --show-bin-path)/Commander"
  test -x "$SWIFT_BIN"
  mkdir -p "$DEV_ROOT" "$DEV_ROOT/fixtures" "$DEV_ROOT/data" "$DEV_ROOT/cache"
  rm -rf -- "$APP"
  RESOURCES="$APP/Contents/Resources"
  mkdir -p "$APP/Contents/MacOS" "$RESOURCES/ui" "$RESOURCES/node/bin"
  ditto "$SWIFT_BIN" "$EXECUTABLE"
  ditto "$ROOT/apps/desktop-ui/dist" "$RESOURCES/ui"
  ditto "$ROOT/apps/daemon/dist/commander-daemon.mjs" "$RESOURCES/commander-daemon.mjs"
  ditto "$ROOT/apps/daemon/dist/worker.js" "$RESOURCES/worker.js"
  ditto "$ROOT/crates/commander-core/target/debug/commander-search" "$RESOURCES/commander-core"
  ditto "$ROOT/crates/commander-indexer/target/debug/commander-indexer" "$RESOURCES/commander-indexer"
  # Reuse an executable only, never any installed app settings or credentials.
  NODE_EXECUTABLE="${COMMANDER_DEV_NODE:-$(node -p 'process.execPath')}"
  NODE_EXECUTABLE="$(node -p 'require("node:fs").realpathSync(process.argv[1])' "$NODE_EXECUTABLE")"
  ditto "$NODE_EXECUTABLE" "$RESOURCES/node/bin/node"
  PLIST="$APP/Contents/Info.plist"
  plutil -create xml1 "$PLIST"
  plutil -insert CFBundleExecutable -string CommanderDevelopment "$PLIST"
  plutil -insert CFBundleIdentifier -string "com.thingtime.Commander.development.$KEY" "$PLIST"
  plutil -insert CFBundleName -string 'Commander Development' "$PLIST"
  plutil -insert CFBundlePackageType -string APPL "$PLIST"
  plutil -insert LSUIElement -bool true "$PLIST"
  plutil -insert CommanderIsolatedDevelopment -bool true "$PLIST"
  plutil -insert CommanderDevelopmentPort -integer "$PORT" "$PLIST"
  # The dev identity never registers the production OAuth URL scheme.
  xattr -cr "$APP"
  node --input-type=module - "$ROOT" "$DEV_ROOT" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [root, development] = process.argv.slice(2);
const statePath = path.join(development, 'data/state.json');
if (!fs.existsSync(statePath)) {
  const {DEFAULT_SETTINGS} = await import(pathToFileURL(path.join(root, 'packages/protocol/dist/index.js')));
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.indexing.roots = [path.join(development, 'fixtures')];
  settings.openAtLogin = false;
  fs.writeFileSync(statePath, JSON.stringify({version:1,settings,accounts:[],extensions:[],extensionPreferences:[],recentSearches:[],searchPreferences:[]}), {mode:0o600});
}
NODE
  printf 'App: %s\nFixtures: %s\nPort: %s\n' "$APP" "$DEV_ROOT/fixtures" "$PORT"
  exit
fi
if host_pid >/dev/null; then echo 'Development host already running.'; exit; fi
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is occupied; no process was changed." >&2; exit 1
fi
test -x "$EXECUTABLE"
/usr/bin/open -n "$APP" >/dev/null 2>&1 &
OPEN_PID="$!"
for _ in {1..100}; do
  CANDIDATE_PID="$(pgrep -f "^$EXECUTABLE$" | head -n 1 || true)"
  if [[ -n "$CANDIDATE_PID" && "$(ps -p "$CANDIDATE_PID" -o comm= 2>/dev/null)" == "$EXECUTABLE" ]] && curl --fail --silent --max-time 1 "http://127.0.0.1:$PORT/healthz" >/dev/null; then
    printf '%s\n' "$CANDIDATE_PID" >"$PID_FILE"
    kill -TERM "$OPEN_PID" 2>/dev/null || true
    wait "$OPEN_PID" 2>/dev/null || true
    printf 'Started isolated Commander at http://127.0.0.1:%s\nFixtures: %s\n' "$PORT" "$DEV_ROOT/fixtures"
    exit
  fi
  sleep 0.1
done
kill -TERM "$OPEN_PID" 2>/dev/null || true
wait "$OPEN_PID" 2>/dev/null || true
echo "Development host did not become ready; installed Commander was not changed." >&2
exit 1

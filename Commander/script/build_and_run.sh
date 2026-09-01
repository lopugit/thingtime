#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Commander"
BUNDLE_ID="com.thingtime.Commander"
MIN_SYSTEM_VERSION="14.0"
# Direct-distribution builds must use a Developer ID Application identity.  Do
# not silently substitute an Apple Development or Apple Distribution identity:
# neither gives users the Gatekeeper trust contract of a notarized Developer ID
# app.  Local development is available as an explicit opt-in below.
SIGNING_MODE="${COMMANDER_SIGNING_MODE:-distribution}"
SIGNING_IDENTITY="${COMMANDER_SIGNING_IDENTITY:-}"
SIGNING_TIMESTAMP_ARGS=()
NOTARIZATION_MODE="${COMMANDER_NOTARIZATION_MODE:-local}"
NOTARY_PROFILE="${COMMANDER_NOTARY_PROFILE:-Commander Notarization}"
NODE_VERSION="22.23.2"
NODE_SHA256_ARM64="61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6"
NODE_SHA256_X64="58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
CONTENTS="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES_DIR="$CONTENTS/Resources"
SWIFT_PACKAGE="$ROOT_DIR/hosts/macos"
PACKAGE_VERSION="$(node -p "require(process.argv[1]).version" "$ROOT_DIR/package.json")"
BUILD_NUMBER="${COMMANDER_BUILD_NUMBER:-1}"

if [[ ! "$PACKAGE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Commander package version must be X.Y.Z: $PACKAGE_VERSION" >&2
  exit 1
fi
if [[ ! "$BUILD_NUMBER" =~ ^[0-9]+$ ]] || [[ "$BUILD_NUMBER" == "0" ]]; then
  echo "COMMANDER_BUILD_NUMBER must be a positive integer: $BUILD_NUMBER" >&2
  exit 1
fi

available_signing_identity() {
  /usr/bin/security find-identity -v -p codesigning | /usr/bin/grep -F "\"$1\"" >/dev/null
}

default_developer_id_identity() {
  /usr/bin/security find-identity -v -p codesigning \
    | /usr/bin/sed -nE 's/.*"(Developer ID Application: [^"]+)".*/\1/p' \
    | /usr/bin/head -n 1
}

resolve_signing_configuration() {
  case "$SIGNING_MODE" in
    distribution)
      if [[ -z "$SIGNING_IDENTITY" ]]; then
        SIGNING_IDENTITY="$(default_developer_id_identity)"
      fi
      if [[ -z "$SIGNING_IDENTITY" ]]; then
        echo "Commander distribution builds require an installed Developer ID Application identity." >&2
        echo "Install a Developer ID Application certificate with its private key, then retry." >&2
        echo "For explicitly local-only development, use COMMANDER_SIGNING_MODE=development." >&2
        exit 1
      fi
      if [[ "$SIGNING_IDENTITY" != Developer\ ID\ Application:* ]]; then
        echo "Commander distribution builds require a Developer ID Application identity, not: $SIGNING_IDENTITY" >&2
        exit 1
      fi
      if [[ "$NOTARIZATION_MODE" != "local" && "$NOTARIZATION_MODE" != "external" ]]; then
        echo "COMMANDER_NOTARIZATION_MODE must be local or external: $NOTARIZATION_MODE" >&2
        exit 1
      fi
      SIGNING_TIMESTAMP_ARGS=(--timestamp)
      ;;
    development)
      if [[ -z "$SIGNING_IDENTITY" ]]; then
        SIGNING_IDENTITY="Apple Development: lopudesigns@gmail.com (9BTZ4XB356)"
      fi
      SIGNING_TIMESTAMP_ARGS=(--timestamp=none)
      ;;
    *)
      echo "COMMANDER_SIGNING_MODE must be distribution or development: $SIGNING_MODE" >&2
      exit 1
      ;;
  esac

  if [[ "$SIGNING_IDENTITY" != "-" ]] && ! available_signing_identity "$SIGNING_IDENTITY"; then
    echo "Commander signing identity is unavailable: $SIGNING_IDENTITY" >&2
    exit 1
  fi
  if [[ "$SIGNING_MODE" == "distribution" && "$SIGNING_IDENTITY" == "-" ]]; then
    echo "Ad-hoc signing is not allowed for Commander distribution builds." >&2
    exit 1
  fi
}

notarize_distribution_bundle() {
  [[ "$SIGNING_MODE" == "distribution" ]] || return 0
  [[ "$NOTARIZATION_MODE" == "local" ]] || return 0

  local archive_root archive
  archive_root="$(mktemp -d "$HOME/Library/Caches/$BUNDLE_ID/Commander-notarization.XXXXXX")"
  archive="$archive_root/$APP_NAME.zip"
  trap '/bin/rm -rf "'"$archive_root"'"' RETURN
  /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$archive"
  /usr/bin/xcrun notarytool submit "$archive" --wait --keychain-profile "$NOTARY_PROFILE"
  /usr/bin/xcrun stapler staple "$APP_BUNDLE"
  /usr/bin/xcrun stapler validate "$APP_BUNDLE"
  /usr/sbin/spctl -a -vv --type execute "$APP_BUNDLE"
  trap - RETURN
  /bin/rm -rf "$archive_root"
}

build_all() {
  corepack pnpm --dir "$ROOT_DIR" install --frozen-lockfile
  corepack pnpm --dir "$ROOT_DIR" typecheck
  corepack pnpm --dir "$ROOT_DIR" test
  corepack pnpm --dir "$ROOT_DIR" build

  if ! command -v cargo >/dev/null 2>&1; then
    echo "Commander requires Cargo to build its bundled search and filesystem indexer binaries" >&2
    exit 1
  fi
  cargo build --release --manifest-path "$ROOT_DIR/crates/commander-core/Cargo.toml"
  local rust_binary="$ROOT_DIR/crates/commander-core/target/release/commander-search"
  cargo build --release --manifest-path "$ROOT_DIR/crates/commander-indexer/Cargo.toml"
  local rust_indexer_binary="$ROOT_DIR/crates/commander-indexer/target/release/commander-indexer"

  swift build --package-path "$SWIFT_PACKAGE" -c release
  local swift_binary
  swift_binary="$(swift build --package-path "$SWIFT_PACKAGE" -c release --show-bin-path)/Commander"

  local stage_root="$HOME/Library/Caches/$BUNDLE_ID/bundle-stage"
  local staged_bundle="$stage_root/$APP_NAME.app"
  mkdir -p "$stage_root"
  if [[ -e "$staged_bundle" ]]; then
    /usr/bin/osascript -e 'tell application "Finder" to delete POSIX file "'"$staged_bundle"'"' >/dev/null 2>&1 || /bin/rm -rf "$staged_bundle"
  fi
  mkdir -p "$staged_bundle/Contents/MacOS" "$staged_bundle/Contents/Resources/ui"
  /usr/bin/ditto "$swift_binary" "$staged_bundle/Contents/MacOS/$APP_NAME"
  /usr/bin/ditto "$ROOT_DIR/apps/desktop-ui/dist" "$staged_bundle/Contents/Resources/ui"
  /usr/bin/ditto "$ROOT_DIR/apps/daemon/dist/commander-daemon.mjs" "$staged_bundle/Contents/Resources/commander-daemon.mjs"
  /usr/bin/ditto "$ROOT_DIR/apps/daemon/dist/worker.js" "$staged_bundle/Contents/Resources/worker.js"
  /usr/bin/ditto "$ROOT_DIR/THIRD_PARTY_NOTICES.md" "$staged_bundle/Contents/Resources/THIRD_PARTY_NOTICES.md"
  stage_node "$staged_bundle/Contents/Resources/node"
  stage_icon "$staged_bundle/Contents/Resources/$APP_NAME.icns"
  if [[ -n "$rust_binary" && -x "$rust_binary" ]]; then
    /usr/bin/ditto "$rust_binary" "$staged_bundle/Contents/Resources/commander-core"
  fi
  if [[ -n "$rust_indexer_binary" && -x "$rust_indexer_binary" ]]; then
    /usr/bin/ditto "$rust_indexer_binary" "$staged_bundle/Contents/Resources/commander-indexer"
  fi

  /usr/bin/plutil -create xml1 "$staged_bundle/Contents/Info.plist"
  /usr/bin/plutil -insert CFBundleExecutable -string "$APP_NAME" "$staged_bundle/Contents/Info.plist"
  /usr/bin/plutil -insert CFBundleIdentifier -string "$BUNDLE_ID" "$staged_bundle/Contents/Info.plist"
  /usr/bin/plutil -insert CFBundleName -string "$APP_NAME" "$staged_bundle/Contents/Info.plist"
  /usr/bin/plutil -insert CFBundleDisplayName -string "$APP_NAME" "$staged_bundle/Contents/Info.plist"
  /usr/bin/plutil -insert CFBundleIconFile -string "$APP_NAME.icns" "$staged_bundle/Contents/Info.plist"
  /usr/bin/plutil -insert CFBundlePackageType -string APPL "$staged_bundle/Contents/Info.plist"
  /usr/bin/plutil -insert CFBundleShortVersionString -string "$PACKAGE_VERSION" "$staged_bundle/Contents/Info.plist"
  /usr/bin/plutil -insert CFBundleVersion -string "$BUILD_NUMBER" "$staged_bundle/Contents/Info.plist"
  /usr/bin/plutil -insert LSMinimumSystemVersion -string "$MIN_SYSTEM_VERSION" "$staged_bundle/Contents/Info.plist"
  /usr/bin/plutil -insert LSUIElement -bool true "$staged_bundle/Contents/Info.plist"
  # Commander owns one daemon/loopback port. Let Launch Services reactivate the
  # existing host rather than spawning a second instance that races for it.
  /usr/bin/plutil -insert LSMultipleInstancesProhibited -bool true "$staged_bundle/Contents/Info.plist"
  /usr/bin/plutil -insert NSHighResolutionCapable -bool true "$staged_bundle/Contents/Info.plist"
  /usr/bin/plutil -insert NSPrincipalClass -string NSApplication "$staged_bundle/Contents/Info.plist"
  /usr/bin/plutil -insert CFBundleURLTypes -json '[{"CFBundleURLName":"com.thingtime.Commander.oauth","CFBundleURLSchemes":["com.thingtime.commander"]}]' "$staged_bundle/Contents/Info.plist"

  /usr/bin/xattr -cr "$staged_bundle"
  # Preserve Node.js Foundation's hardened-runtime signature and JIT entitlements.
  /usr/bin/codesign --verify --strict "$staged_bundle/Contents/Resources/node/bin/node"
  if [[ -x "$staged_bundle/Contents/Resources/commander-core" ]]; then
    /usr/bin/codesign --force --options runtime "${SIGNING_TIMESTAMP_ARGS[@]}" --sign "$SIGNING_IDENTITY" "$staged_bundle/Contents/Resources/commander-core"
  fi
  if [[ -x "$staged_bundle/Contents/Resources/commander-indexer" ]]; then
    /usr/bin/codesign --force --options runtime "${SIGNING_TIMESTAMP_ARGS[@]}" --sign "$SIGNING_IDENTITY" "$staged_bundle/Contents/Resources/commander-indexer"
  fi
  /usr/bin/codesign --force --options runtime "${SIGNING_TIMESTAMP_ARGS[@]}" --sign "$SIGNING_IDENTITY" "$staged_bundle/Contents/MacOS/$APP_NAME"
  /usr/bin/codesign --force --options runtime "${SIGNING_TIMESTAMP_ARGS[@]}" --sign "$SIGNING_IDENTITY" "$staged_bundle"
  /usr/bin/codesign --verify --deep --strict "$staged_bundle"

  mkdir -p "$DIST_DIR"
  if [[ -e "$APP_BUNDLE" ]]; then
    /usr/bin/osascript -e 'tell application "Finder" to delete POSIX file "'"$APP_BUNDLE"'"' >/dev/null 2>&1 || /bin/rm -rf "$APP_BUNDLE"
  fi
  /usr/bin/ditto "$staged_bundle" "$APP_BUNDLE"
  /usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"
}

stage_icon() {
  local destination="$1"
  local source="$ROOT_DIR/design/commander-app-icon.png"
  local icon_root iconset
  icon_root="$(mktemp -d "$HOME/Library/Caches/$BUNDLE_ID/Commander-icon.XXXXXX")"
  iconset="$icon_root/Commander.iconset"
  mkdir -p "$iconset"
  trap '/bin/rm -rf "'"$icon_root"'"' RETURN
  /usr/bin/sips -z 16 16 "$source" --out "$iconset/icon_16x16.png" >/dev/null
  /usr/bin/sips -z 32 32 "$source" --out "$iconset/icon_16x16@2x.png" >/dev/null
  /usr/bin/sips -z 32 32 "$source" --out "$iconset/icon_32x32.png" >/dev/null
  /usr/bin/sips -z 64 64 "$source" --out "$iconset/icon_32x32@2x.png" >/dev/null
  /usr/bin/sips -z 128 128 "$source" --out "$iconset/icon_128x128.png" >/dev/null
  /usr/bin/sips -z 256 256 "$source" --out "$iconset/icon_128x128@2x.png" >/dev/null
  /usr/bin/sips -z 256 256 "$source" --out "$iconset/icon_256x256.png" >/dev/null
  /usr/bin/sips -z 512 512 "$source" --out "$iconset/icon_256x256@2x.png" >/dev/null
  /usr/bin/sips -z 512 512 "$source" --out "$iconset/icon_512x512.png" >/dev/null
  /usr/bin/sips -z 1024 1024 "$source" --out "$iconset/icon_512x512@2x.png" >/dev/null
  /usr/bin/iconutil -c icns "$iconset" -o "$destination"
  trap - RETURN
  /bin/rm -rf "$icon_root"
}

stage_node() {
  local destination="$1"
  local architecture archive checksum cache_root download extracted
  architecture="$(uname -m)"
  case "$architecture" in
    arm64) archive="node-v$NODE_VERSION-darwin-arm64.tar.gz"; checksum="$NODE_SHA256_ARM64" ;;
    x86_64) archive="node-v$NODE_VERSION-darwin-x64.tar.gz"; checksum="$NODE_SHA256_X64" ;;
    *) echo "unsupported macOS architecture: $architecture" >&2; exit 1 ;;
  esac
  cache_root="$HOME/Library/Caches/$BUNDLE_ID/node-runtime"
  download="$cache_root/$archive"
  extracted="$cache_root/${archive%.tar.gz}"
  mkdir -p "$cache_root"
  if [[ ! -f "$download" ]]; then /usr/bin/curl --fail --location --silent --show-error "https://nodejs.org/dist/v$NODE_VERSION/$archive" --output "$download"; fi
  if ! echo "$checksum  $download" | /usr/bin/shasum -a 256 -c - >/dev/null; then
    echo "Node runtime checksum verification failed" >&2
    exit 1
  fi
  if [[ ! -x "$extracted/bin/node" ]]; then
    /usr/bin/tar -xzf "$download" -C "$cache_root"
  fi
  mkdir -p "$destination/bin"
  /usr/bin/ditto "$extracted/bin/node" "$destination/bin/node"
}

install_app() {
  local install_root="$HOME/Applications"
  local installed="$install_root/$APP_NAME.app"
  mkdir -p "$install_root"
  if [[ -e "$installed" ]]; then
    /usr/bin/osascript -e 'tell application "Finder" to delete POSIX file "'"$installed"'"' >/dev/null 2>&1 || /bin/rm -rf "$installed"
  fi
  /usr/bin/ditto "$APP_BUNDLE" "$installed"
  /usr/bin/codesign --verify --deep --strict "$installed"
  test -x "$installed/Contents/MacOS/$APP_NAME"
}

launch_installed_app() {
  local installed="$HOME/Applications/$APP_NAME.app"
  local host_pattern="^$installed/Contents/MacOS/$APP_NAME$"
  /usr/bin/open "$installed" >/dev/null 2>&1 &
  local open_pid="$!"

  # `open` can remain blocked waiting for a Launch Services XPC reply after it
  # has already launched the app. Do not make packaging or verification wait
  # forever on that helper: give it a short normal-completion window, then
  # terminate only that helper once the installed host is confirmed running.
  for _ in {1..20}; do
    if ! /bin/kill -0 "$open_pid" >/dev/null 2>&1; then
      if wait "$open_pid"; then return 0; fi
      echo "Commander launch helper exited before the installed app was ready." >&2
      return 1
    fi
    sleep 0.1
  done
  if /usr/bin/pgrep -f "$host_pattern" >/dev/null 2>&1; then
    /bin/kill -TERM "$open_pid" >/dev/null 2>&1 || true
    wait "$open_pid" 2>/dev/null || true
    return 0
  fi
  /bin/kill -TERM "$open_pid" >/dev/null 2>&1 || true
  wait "$open_pid" 2>/dev/null || true
  echo "Commander launch helper did not start the installed app within two seconds." >&2
  return 1
}

stop_installed_runtime() {
  local installed="$HOME/Applications/$APP_NAME.app"
  local host_pattern="^$installed/Contents/MacOS/$APP_NAME$"
  local daemon_pattern="^$installed/Contents/Resources/node/bin/node $installed/Contents/Resources/commander-daemon.mjs( |$)"
  local core_pattern="^$installed/Contents/Resources/commander-core$"
  local indexer_pattern="^$installed/Contents/Resources/commander-indexer( |$)"

  if /usr/bin/pgrep -f "$host_pattern" >/dev/null 2>&1; then
    /usr/bin/osascript -e 'tell application id "'"$BUNDLE_ID"'" to quit' >/dev/null 2>&1 || true
  fi
  for _ in {1..40}; do
    if ! /usr/bin/pgrep -f "$host_pattern" >/dev/null 2>&1; then break; fi
    sleep 0.05
  done
  /usr/bin/pkill -TERM -f "$host_pattern" >/dev/null 2>&1 || true
  /usr/bin/pkill -TERM -f "$daemon_pattern" >/dev/null 2>&1 || true
  /usr/bin/pkill -TERM -f "$core_pattern" >/dev/null 2>&1 || true
  /usr/bin/pkill -TERM -f "$indexer_pattern" >/dev/null 2>&1 || true
  for _ in {1..40}; do
    if ! /usr/sbin/lsof -nP -iTCP:47820 -sTCP:LISTEN >/dev/null 2>&1; then return; fi
    sleep 0.05
  done

  /usr/bin/pkill -KILL -f "$host_pattern" >/dev/null 2>&1 || true
  /usr/bin/pkill -KILL -f "$daemon_pattern" >/dev/null 2>&1 || true
  /usr/bin/pkill -KILL -f "$core_pattern" >/dev/null 2>&1 || true
  /usr/bin/pkill -KILL -f "$indexer_pattern" >/dev/null 2>&1 || true
  sleep 0.1
  if /usr/sbin/lsof -nP -iTCP:47820 -sTCP:LISTEN; then
    echo "Commander cannot start because another process owns 127.0.0.1:47820" >&2
    exit 1
  fi
}

resolve_signing_configuration
stop_installed_runtime
build_all
notarize_distribution_bundle

case "$MODE" in
  --build-only|build)
    ;;
  run)
    install_app
    launch_installed_app
    ;;
  --verify|verify)
    install_app
    launch_installed_app
    for _ in {1..30}; do
      if /usr/bin/pgrep -f "^$HOME/Applications/$APP_NAME.app/Contents/MacOS/$APP_NAME$" >/dev/null; then break; fi
      sleep 0.1
    done
    local_app_pid="$(/usr/bin/pgrep -f "^$HOME/Applications/$APP_NAME.app/Contents/MacOS/$APP_NAME$" | /usr/bin/head -n 1)"
    test -n "$local_app_pid"
    process_command="$(/bin/ps -p "$local_app_pid" -o command=)"
    [[ "$process_command" == "$HOME/Applications/$APP_NAME.app/Contents/MacOS/$APP_NAME"* ]]
    health=""
    # The first launch can migrate and open a large filesystem index before the
    # daemon starts listening. Give that bounded initialization time to finish.
    for _ in {1..300}; do
      if health="$(/usr/bin/curl --fail --silent --show-error --max-time 1 http://127.0.0.1:47820/healthz 2>/dev/null)"; then break; fi
      sleep 0.1
    done
    test -n "$health"
    [[ "$(/usr/bin/plutil -extract ok raw -o - - <<<"$health")" == "true" ]]
    [[ "$(/usr/bin/plutil -extract protocolVersion raw -o - - <<<"$health")" == "1" ]]
    daemon_pid="$(/usr/bin/plutil -extract pid raw -o - - <<<"$health")"
    [[ "$daemon_pid" =~ ^[0-9]+$ ]]
    [[ "$(/bin/ps -p "$daemon_pid" -o ppid= | /usr/bin/xargs)" == "$local_app_pid" ]]
    daemon_command="$(/bin/ps -p "$daemon_pid" -o command=)"
    [[ "$daemon_command" == "$HOME/Applications/$APP_NAME.app/Contents/Resources/node/bin/node $HOME/Applications/$APP_NAME.app/Contents/Resources/commander-daemon.mjs "* ]]
    [[ "$daemon_command" == *" --parent-pid $local_app_pid"* ]]
    indexer_pids="$(/usr/bin/pgrep -f "^$HOME/Applications/$APP_NAME.app/Contents/Resources/commander-indexer serve --database " || true)"
    [[ "$(/bin/echo "$indexer_pids" | /usr/bin/awk 'NF { count += 1 } END { print count + 0 }')" -ge 2 ]]
    while IFS= read -r indexer_pid; do
      [[ -z "$indexer_pid" ]] && continue
      [[ "$(/bin/ps -p "$indexer_pid" -o ppid= | /usr/bin/xargs)" == "$daemon_pid" ]]
    done <<<"$indexer_pids"
    ;;
  --debug|debug)
    lldb -- "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
    ;;
  --logs|logs)
    install_app
    launch_installed_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    install_app
    launch_installed_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  *)
    echo "usage: $0 [run|--build-only|--verify|--debug|--logs|--telemetry]" >&2
    exit 2
    ;;
esac

echo "Built: $APP_BUNDLE"
if [[ "$MODE" != "--build-only" && "$MODE" != "build" && "$MODE" != "--debug" && "$MODE" != "debug" ]]; then
  echo "Installed: $HOME/Applications/$APP_NAME.app"
fi

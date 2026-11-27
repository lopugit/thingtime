#!/usr/bin/env bash
# Xcode build phase: same Rust engine as Commander, linked inside the iOS sandbox.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
platform="${PLATFORM_NAME:-iphonesimulator}"
case "$platform" in iphoneos|iphonesimulator) ;; *) echo "Unsupported Rust indexer platform: $platform" >&2; exit 1 ;; esac
cargo_bin="${THINGTIME_RUST_CARGO:-cargo}"
# An isolated project toolchain avoids changing the developer's global Rust.
# Explicit choices still win; CI normally uses its provisioned rustup toolchain.
if [[ -z "${THINGTIME_RUST_CARGO:-}" && -x "$HOME/Library/Caches/Thingtime/cargo/bin/cargo" ]]; then
  export RUSTUP_HOME="$HOME/Library/Caches/Thingtime/rustup"
  export CARGO_HOME="$HOME/Library/Caches/Thingtime/cargo"
  cargo_bin="$CARGO_HOME/bin/cargo"
fi
if ! command -v "$cargo_bin" >/dev/null 2>&1; then
  echo "Rust cargo is required. Install Rust with rustup and the iOS targets described in README.md." >&2; exit 1
fi
output="${BUILT_PRODUCTS_DIR:-$repo/iOS/build/rust-$platform}"
mkdir -p "$output"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$repo/iOS/build/rust-target}"
export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-17.0}"
export SDKROOT="$(xcrun --sdk "$platform" --show-sdk-path)"
archives=()
for arch in ${ARCHS:-arm64}; do
  case "$platform:$arch" in
    iphoneos:arm64) target=aarch64-apple-ios ;;
    iphonesimulator:arm64) target=aarch64-apple-ios-sim ;;
    iphonesimulator:x86_64) target=x86_64-apple-ios ;;
    *) echo "Unsupported Rust indexer architecture: $platform:$arch" >&2; exit 1 ;;
  esac
  "$cargo_bin" build --locked --release --manifest-path "$repo/filesystem-indexer/crates/ffi/Cargo.toml" --target "$target"
  archives+=("$CARGO_TARGET_DIR/$target/release/libcommander_indexer_ffi.a")
done
# Atomic output: failed builds never replace a previous complete archive.
xcrun lipo -create "${archives[@]}" -output "$output/libcommander_indexer_ffi.a.tmp"
mv "$output/libcommander_indexer_ffi.a.tmp" "$output/libcommander_indexer_ffi.a"

#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
manifest="$repo/filesystem-indexer/crates/ffi/Cargo.toml"
cargo build --locked --manifest-path "$manifest"
archive="$repo/filesystem-indexer/target/debug/libcommander_indexer_ffi.a"
# A separate scratch directory avoids races with normal native package tests.
swift run --package-path "$repo/apple/FileSync" --scratch-path "$repo/apple/FileSync/.build-embedded" \
  -Xlinker -force_load -Xlinker "$archive" -Xlinker -lsqlite3 -Xlinker -liconv FileSyncEmbeddedFixture
